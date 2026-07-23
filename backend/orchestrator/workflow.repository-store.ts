/**
 * Durable workflow store — Sprint 11.
 *
 * Replaces the in-memory Map-based WorkflowStoreInterface implementation
 * with one backed by the DynamoDB-backed WorkflowRepository (workflow
 * lifecycle, status, execution metadata, created/updated timestamps) and
 * OwnershipRepository (durable cross-tenant ownership lookups, used only to
 * produce safe 404s — never to bypass tenant scoping).
 *
 * Persistence survives Lambda cold starts and is safe under concurrent
 * invocations: every write is a tenant-scoped, optimistically-versioned
 * DynamoDB operation (conditional create / conditional update), so two
 * concurrent executions can never silently clobber each other or produce
 * duplicate workflow records.
 */

import { recordBelongsToTenant } from '../auth/tenant';
import { WORKFLOW_STATES, type WorkflowState } from '../shared/constants';
import { createLogger } from '../shared/utils';
import { RepositoryAlreadyExistsError, RepositoryConflictError } from '../database';
import type {
  OwnershipRepository,
  WorkflowRepository,
  WorkflowRecord as PersistedWorkflowRecord,
  WorkflowStatus as PersistedWorkflowStatus,
} from '../repositories';
import type { WorkflowStoreInterface } from './workflow.store';
import type {
  WorkflowContext,
  WorkflowMetadata,
  WorkflowRecord,
  HardenedWorkflowResult,
} from './workflow.types';

const logger = createLogger('RepositoryBackedWorkflowStore');

/** Retention window applied to workflow records via the table's TTL attribute. */
const WORKFLOW_RETENTION_SECONDS = 90 * 24 * 60 * 60;

/** Shape stored in the repository's opaque `input` bag — the living workflow state. */
interface StoredWorkflowState {
  metadata: WorkflowMetadata;
  context: WorkflowContext;
}

function toPersistedStatus(status: WorkflowState): PersistedWorkflowStatus {
  switch (status) {
    case WORKFLOW_STATES.PENDING:
      return 'PENDING';
    case WORKFLOW_STATES.RUNNING:
      return 'RUNNING';
    case WORKFLOW_STATES.COMPLETED:
      return 'COMPLETED';
    case WORKFLOW_STATES.FAILED:
      return 'FAILED';
    default:
      return 'FAILED';
  }
}

function computeExpiresAt(): number {
  return Math.floor(Date.now() / 1000) + WORKFLOW_RETENTION_SECONDS;
}

function toOrchestratorRecord(item: PersistedWorkflowRecord): WorkflowRecord {
  const state = item.input as unknown as StoredWorkflowState;

  return {
    metadata: {
      ...state.metadata,
      version: item.version,
      updatedAt: item.updatedAt,
    },
    context: state.context,
    result: item.result as unknown as HardenedWorkflowResult | undefined,
  };
}

/**
 * Workflow store backed by durable, tenant-partitioned DynamoDB persistence.
 * See ../repositories/contracts/workflow-repository.ts for the interface
 * supplied by Engineer 1 and ../repositories/dynamodb for the implementation.
 */
export class RepositoryBackedWorkflowStore implements WorkflowStoreInterface {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly ownershipRepository: OwnershipRepository
  ) {}

  async save(record: WorkflowRecord): Promise<void> {
    const { metadata, context } = record;

    await this.workflowRepository.create({
      tenantId: metadata.tenantId,
      workflowId: metadata.workflowId,
      status: toPersistedStatus(metadata.status),
      provider: context.provider,
      resourceId: metadata.resourceId,
      region: metadata.region,
      input: { metadata, context } as unknown as Record<string, unknown>,
      result: undefined,
      idempotencyKey: metadata.idempotencyKey,
      expiresAt: computeExpiresAt(),
    });

    try {
      await this.ownershipRepository.create({
        resourceType: 'WORKFLOW',
        resourceId: metadata.workflowId,
        ownerTenantId: metadata.tenantId,
        expiresAt: computeExpiresAt(),
      });
    } catch (error) {
      if (error instanceof RepositoryAlreadyExistsError) {
        // Benign: an ownership record already exists for this workflowId
        // (e.g. a retried idempotent request). Never overwrite ownership.
        logger.info('Ownership record already exists', {
          workflowId: metadata.workflowId,
          operation: 'save',
        });
        return;
      }

      throw error;
    }
  }

  /**
   * Retries an optimistically-locked update a few times on RepositoryConflictError.
   * A conflict here means another writer touched this exact workflowId between our
   * read and write — e.g. two concurrent Lambda invocations processing the same
   * workflow (a Lambda retry racing the original attempt). Re-reading the latest
   * version and reapplying `buildChanges` guarantees no update is silently lost.
   */
  private async updateWithRetry(
    tenantId: string,
    workflowId: string,
    buildChanges: (
      current: PersistedWorkflowRecord
    ) => Parameters<WorkflowRepository['update']>[2],
    attemptsRemaining = 3
  ): Promise<void> {
    const current = await this.workflowRepository.get(tenantId, workflowId);

    if (!current) {
      return;
    }

    try {
      await this.workflowRepository.update(
        tenantId,
        workflowId,
        buildChanges(current),
        { expectedVersion: current.version }
      );
    } catch (error) {
      if (error instanceof RepositoryConflictError && attemptsRemaining > 0) {
        logger.info('Concurrent workflow update conflict — retrying with latest version', {
          workflowId,
          operation: 'updateWithRetry',
        });
        return this.updateWithRetry(tenantId, workflowId, buildChanges, attemptsRemaining - 1);
      }
      throw error;
    }
  }

  async updateContext(
    tenantId: string,
    workflowId: string,
    context: WorkflowContext
  ): Promise<void> {
    await this.updateWithRetry(tenantId, workflowId, (current) => {
      const currentState = current.input as unknown as StoredWorkflowState;
      const updatedMetadata: WorkflowMetadata = {
        ...currentState.metadata,
        status: context.status,
        executionState: context.executionState,
        ...(context.completedAt ? { completedAt: context.completedAt } : {}),
      };

      return {
        status: toPersistedStatus(context.status),
        input: { metadata: updatedMetadata, context } as unknown as Record<string, unknown>,
      };
    });
  }

  async updateResult(
    tenantId: string,
    workflowId: string,
    result: HardenedWorkflowResult
  ): Promise<void> {
    await this.updateWithRetry(tenantId, workflowId, (current) => {
      const currentState = current.input as unknown as StoredWorkflowState;
      const updatedMetadata: WorkflowMetadata = {
        ...currentState.metadata,
        status: result.status,
        executionState: result.executionState,
        ...(result.completedAt ? { completedAt: result.completedAt } : {}),
      };

      return {
        status: toPersistedStatus(result.status),
        input: {
          metadata: updatedMetadata,
          context: currentState.context,
        } as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
      };
    });
  }

  async get(tenantId: string, workflowId: string): Promise<WorkflowRecord | undefined> {
    const item = await this.workflowRepository.get(tenantId, workflowId);

    if (!item) {
      return undefined;
    }

    if (!recordBelongsToTenant(item.tenantId, tenantId)) {
      return undefined;
    }

    return toOrchestratorRecord(item);
  }

  async getMetadata(
    tenantId: string,
    workflowId: string
  ): Promise<WorkflowMetadata | undefined> {
    const record = await this.get(tenantId, workflowId);
    return record?.metadata;
  }

  async list(tenantId: string, status?: WorkflowState): Promise<WorkflowMetadata[]> {
    const metadata: WorkflowMetadata[] = [];
    let nextToken: string | undefined;

    do {
      const page = status
        ? await this.workflowRepository.listByStatus(
            tenantId,
            toPersistedStatus(status),
            { nextToken }
          )
        : await this.workflowRepository.listByTenant(tenantId, { nextToken });

      for (const item of page.items) {
        metadata.push(toOrchestratorRecord(item).metadata);
      }

      nextToken = page.nextToken;
    } while (nextToken);

    return metadata;
  }

  async resolveOwnerTenantId(workflowId: string): Promise<string | undefined> {
    const ownership = await this.ownershipRepository.get('WORKFLOW', workflowId);
    return ownership?.ownerTenantId;
  }
}

export function createRepositoryBackedWorkflowStore(
  workflowRepository: WorkflowRepository,
  ownershipRepository: OwnershipRepository
): RepositoryBackedWorkflowStore {
  return new RepositoryBackedWorkflowStore(workflowRepository, ownershipRepository);
}
