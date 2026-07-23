/**
 * Workflow persistence — Sprint 11.
 *
 * WorkflowStoreInterface is the seam the orchestrator talks to. Two
 * implementations exist:
 *
 *  - RepositoryBackedWorkflowStore (workflow.repository-store.ts): durable,
 *    tenant-partitioned DynamoDB persistence. Used whenever WORKFLOWS_TABLE_NAME
 *    (and OWNERSHIP_TABLE_NAME) are configured — i.e. in every deployed
 *    environment. Workflow status, execution state, metadata, owner, and
 *    created/updated timestamps all survive Lambda cold starts and are safe
 *    under concurrent invocations (optimistic-locked, conditional writes).
 *
 *  - InMemoryWorkflowStore (below): a Map-based fallback used only for local
 *    development without a configured DynamoDB table, and for unit/integration
 *    tests that want a fast, dependency-free double. It must never be selected
 *    by createWorkflowStore() when a workflows table is configured.
 */

import { recordBelongsToTenant } from '../auth/tenant';
import { dynamoDbDocumentClient } from '../database';
import { isPersistenceEnabled } from '../persistence/persistence-table';
import {
  DynamoDbOwnershipRepository,
  DynamoDbWorkflowRepository,
} from '../repositories';
import type { WorkflowState } from '../shared/constants';
import { createLogger } from '../shared/utils';
import { createRepositoryBackedWorkflowStore } from './workflow.repository-store';
import type { WorkflowContext, WorkflowMetadata, WorkflowRecord, HardenedWorkflowResult } from './workflow.types';

const logger = createLogger('WorkflowStore');

function buildStoreKey(tenantId: string, workflowId: string): string {
  return `${tenantId}:${workflowId}`;
}

/** Interface for workflow persistence — implemented by DynamoDB (production)
 * and by an in-memory fallback (local dev / tests without a configured table). */
export interface WorkflowStoreInterface {
  save(record: WorkflowRecord): Promise<void>;
  updateContext(tenantId: string, workflowId: string, context: WorkflowContext): Promise<void>;
  updateResult(tenantId: string, workflowId: string, result: HardenedWorkflowResult): Promise<void>;
  get(tenantId: string, workflowId: string): Promise<WorkflowRecord | undefined>;
  getMetadata(tenantId: string, workflowId: string): Promise<WorkflowMetadata | undefined>;
  list(tenantId: string, status?: WorkflowState): Promise<WorkflowMetadata[]>;
  resolveOwnerTenantId(workflowId: string): Promise<string | undefined>;
}

/**
 * In-memory workflow registry. Local-dev / test fallback ONLY — not used in
 * any deployed environment, where WORKFLOWS_TABLE_NAME is always configured.
 */
export class InMemoryWorkflowStore implements WorkflowStoreInterface {
  private readonly records = new Map<string, WorkflowRecord>();
  private readonly ownerIndex = new Map<string, string>();

  async save(record: WorkflowRecord): Promise<void> {
    const key = buildStoreKey(
      record.metadata.tenantId,
      record.metadata.workflowId
    );
    this.records.set(key, record);
    this.ownerIndex.set(
      record.metadata.workflowId,
      record.metadata.tenantId
    );
  }

  async updateContext(tenantId: string, workflowId: string, context: WorkflowContext): Promise<void> {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));
    if (!record) {
      return;
    }
    record.context = context;
    record.metadata.status = context.status;
    record.metadata.executionState = context.executionState;
    record.metadata.updatedAt = new Date().toISOString();
    if (context.completedAt) {
      record.metadata.completedAt = context.completedAt;
    }
  }

  async updateResult(tenantId: string, workflowId: string, result: HardenedWorkflowResult): Promise<void> {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));
    if (!record) {
      return;
    }
    record.result = result;
    record.metadata.status = result.status;
    record.metadata.executionState = result.executionState;
    record.metadata.completedAt = result.completedAt;
    record.metadata.updatedAt = new Date().toISOString();
  }

  async get(tenantId: string, workflowId: string): Promise<WorkflowRecord | undefined> {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));

    if (!record) {
      return undefined;
    }

    if (!recordBelongsToTenant(record.metadata.tenantId, tenantId)) {
      return undefined;
    }

    return record;
  }

  async getMetadata(tenantId: string, workflowId: string): Promise<WorkflowMetadata | undefined> {
    return (await this.get(tenantId, workflowId))?.metadata;
  }

  async list(tenantId: string, status?: WorkflowState): Promise<WorkflowMetadata[]> {
    const all = Array.from(this.records.values())
      .filter((record) =>
        recordBelongsToTenant(record.metadata.tenantId, tenantId)
      )
      .map((record) => record.metadata);

    if (!status) {
      return all;
    }

    return all.filter((metadata) => metadata.status === status);
  }

  async resolveOwnerTenantId(workflowId: string): Promise<string | undefined> {
    return this.ownerIndex.get(workflowId);
  }
}

/**
 * Resolve the workflow store for this process.
 *
 * Chooses durable DynamoDB persistence whenever WORKFLOWS_TABLE_NAME and
 * OWNERSHIP_TABLE_NAME are configured and persistence is not explicitly
 * disabled (PERSISTENCE_ENABLED=false) — which is always true in deployed
 * environments (see backend/template.yaml). Falls back to an in-memory store
 * only for local development without those tables configured.
 */
export function createWorkflowStore(): WorkflowStoreInterface {
  const workflowsTableName = process.env.WORKFLOWS_TABLE_NAME?.trim();
  const ownershipTableName = process.env.OWNERSHIP_TABLE_NAME?.trim();

  if (isPersistenceEnabled() && workflowsTableName && ownershipTableName) {
    const workflowRepository = new DynamoDbWorkflowRepository(
      dynamoDbDocumentClient,
      workflowsTableName
    );
    const ownershipRepository = new DynamoDbOwnershipRepository(
      dynamoDbDocumentClient,
      ownershipTableName
    );

    return createRepositoryBackedWorkflowStore(workflowRepository, ownershipRepository);
  }

  logger.warn(
    'Falling back to in-memory workflow store — data will not survive a Lambda cold start. ' +
      'Configure WORKFLOWS_TABLE_NAME and OWNERSHIP_TABLE_NAME for durable persistence.',
    { operation: 'createWorkflowStore' }
  );

  return new InMemoryWorkflowStore();
}
