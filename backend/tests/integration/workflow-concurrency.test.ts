/**
 * Sprint 11 / Task 5 — concurrent Lambda execution safety.
 *
 * Uses a stateful fake DynamoDB client (in-memory table with realistic
 * conditional-write semantics and randomized latency) to prove two
 * invariants that don't hold for the old Map()-based store:
 *
 *  1. Two concurrent executions racing to create the same idempotent
 *     workflow never produce two workflow records — DynamoDB's atomic
 *     conditional put means exactly one wins, and the loser replays the
 *     winner's result instead of erroring or duplicating work.
 *  2. Two concurrent updates to the *same* workflow record never silently
 *     lose a write — optimistic-locked updates retry against the latest
 *     version instead of clobbering each other.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createConfidenceEngine,
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createLearningStore,
  createRecommendationEngine,
  createVerificationEngine,
} from '../../engines';
import { createExecutionSimulator } from '../../execution';
import { createWorkflowOrchestrator } from '../../orchestrator';
import { RepositoryBackedWorkflowStore } from '../../orchestrator/workflow.repository-store';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { DynamoDbOwnershipRepository, DynamoDbWorkflowRepository } from '../../repositories';
import { PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';

const TENANT_ID = 'sisum-default';
const TABLE_NAME = 'fake-workflows-table';

/**
 * Minimal in-memory stand-in for a DynamoDB table. Models the two
 * conditional-write semantics the repositories depend on:
 *  - PutCommand with `attribute_not_exists(pk)` — exactly one concurrent
 *    caller can create a given item.
 *  - UpdateCommand with `#version = :expectedVersion` — exactly one
 *    concurrent caller can apply an update built against a given version.
 * A randomized delay is added before each operation resolves so that
 * concurrent callers genuinely interleave, the way separate Lambda
 * execution environments would.
 */
class FakeDynamoTable {
  private readonly items = new Map<string, Record<string, unknown>>();

  private key(pk: string, sk: string): string {
    return `${pk}#${sk}`;
  }

  private async latency(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8)));
  }

  private conditionalCheckFailure(): Error {
    const error = new Error('Conditional check failed.');
    error.name = 'ConditionalCheckFailedException';
    return error;
  }

  async send(command: { constructor: { name: string }; input: Record<string, any> }): Promise<any> {
    await this.latency();

    switch (command.constructor.name) {
      case 'PutCommand': {
        const { Item, ConditionExpression } = command.input;
        const k = this.key(Item.pk, Item.sk);
        if (ConditionExpression?.includes('attribute_not_exists') && this.items.has(k)) {
          throw this.conditionalCheckFailure();
        }
        this.items.set(k, { ...Item });
        return {};
      }

      case 'GetCommand': {
        const { Key } = command.input;
        const item = this.items.get(this.key(Key.pk, Key.sk));
        return item ? { Item: { ...item } } : {};
      }

      case 'UpdateCommand': {
        const { Key, ExpressionAttributeNames, ExpressionAttributeValues } = command.input;
        const k = this.key(Key.pk, Key.sk);
        const existing = this.items.get(k);

        if (!existing) {
          throw this.conditionalCheckFailure();
        }

        const expectedVersion = ExpressionAttributeValues[':expectedVersion'];
        if (expectedVersion !== undefined && existing.version !== expectedVersion) {
          throw this.conditionalCheckFailure();
        }

        const updated: Record<string, unknown> = { ...existing };
        for (const [namePlaceholder, fieldName] of Object.entries(
          ExpressionAttributeNames ?? {}
        )) {
          if (fieldName === 'version') {
            updated.version = (existing.version as number) + 1;
            continue;
          }
          if (fieldName === 'updatedAt') {
            updated.updatedAt = ExpressionAttributeValues[':updatedAt'];
            continue;
          }
          const match = /^#field(\d+)$/.exec(namePlaceholder);
          if (match) {
            updated[fieldName as string] = ExpressionAttributeValues[`:value${match[1]}`];
          }
        }

        this.items.set(k, updated);
        return { Attributes: { ...updated } };
      }

      case 'DeleteCommand': {
        const { Key } = command.input;
        this.items.delete(this.key(Key.pk, Key.sk));
        return {};
      }

      default:
        throw new Error(`Unsupported command in fake table: ${command.constructor.name}`);
    }
  }

  size(): number {
    return this.items.size;
  }
}

function buildOrchestrator(store: RepositoryBackedWorkflowStore) {
  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);

  return createWorkflowOrchestrator({
    evidenceEngine: createEvidenceEngine(),
    governanceEngine: createGovernanceEngine(),
    financialEngine: createFinancialEngine({ provider }),
    confidenceEngine: createConfidenceEngine(),
    recommendationEngine: createRecommendationEngine(),
    verificationEngine: createVerificationEngine(),
    executionSimulator: createExecutionSimulator(),
    learningStore: createLearningStore(),
    getPlugin: (name) => pluginRegistry.get(name),
    workflowStore: store,
  });
}

describe('Workflow concurrency (Task 5)', () => {
  it('two concurrent requests with the same idempotency key never create duplicate workflows', async () => {
    const table = new FakeDynamoTable();
    const workflowRepository = new DynamoDbWorkflowRepository(table as any, TABLE_NAME);
    const ownershipRepository = new DynamoDbOwnershipRepository(table as any, TABLE_NAME);
    const store = new RepositoryBackedWorkflowStore(workflowRepository, ownershipRepository);
    const orchestrator = buildOrchestrator(store);

    const request = {
      tenantId: TENANT_ID,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full' as const,
      idempotencyKey: 'checkout-request-42',
    };

    const [first, second] = await Promise.all([
      orchestrator.executeWorkflow(request),
      orchestrator.executeWorkflow(request),
    ]);

    // Same logical workflow both times — no duplicate was created.
    assert.equal(first.workflowId, second.workflowId);

    // Exactly one of the two calls actually created/ran the workflow; the
    // other transparently replayed it.
    const duplicateFlags = [first.duplicate ?? false, second.duplicate ?? false].sort();
    assert.deepEqual(duplicateFlags, [false, true]);

    // Only one workflow item (plus its ownership record) exists in the table.
    assert.equal(table.size(), 2);
  });

  it('concurrent context updates to the same workflow are never lost', async () => {
    const table = new FakeDynamoTable();
    const workflowRepository = new DynamoDbWorkflowRepository(table as any, TABLE_NAME);
    const ownershipRepository = new DynamoDbOwnershipRepository(table as any, TABLE_NAME);
    const store = new RepositoryBackedWorkflowStore(workflowRepository, ownershipRepository);

    const workflowId = 'wf-concurrency-test';
    const baseMetadata = {
      workflowId,
      tenantId: TENANT_ID,
      plugin: PLUGIN_NAMES.EC2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running' as const,
      executionState: 'initialized' as const,
      triggerSource: 'api' as const,
      region: 'us-east-1',
    };
    const baseContext = {
      workflowId,
      tenantId: TENANT_ID,
      plugin: PLUGIN_NAMES.EC2,
      provider: PROVIDER_NAMES.MOCK,
      region: 'us-east-1',
      status: 'running' as const,
      executionState: 'initialized' as const,
      startedAt: new Date().toISOString(),
      completedStages: [] as string[],
      failedStages: [] as string[],
      retry: { attempts: [] as unknown[] },
    };

    await store.save({ metadata: baseMetadata, context: baseContext as any });

    // Two "concurrent Lambda invocations" each read the same starting
    // version and try to update the context independently.
    await Promise.all([
      store.updateContext(TENANT_ID, workflowId, {
        ...baseContext,
        currentStage: 'evidence',
      } as any),
      store.updateContext(TENANT_ID, workflowId, {
        ...baseContext,
        currentStage: 'governance',
      } as any),
    ]);

    const record = await store.get(TENANT_ID, workflowId);
    assert.ok(record);
    // Both updates applied — version advanced by 2 from the initial save,
    // and no RepositoryConflictError escaped either call.
    assert.equal(record.metadata.version, 3);
  });
});
