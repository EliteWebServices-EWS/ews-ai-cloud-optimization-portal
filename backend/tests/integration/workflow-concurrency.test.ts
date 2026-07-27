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
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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
import { createWorkflowOrchestrator, createRetryState } from '../../orchestrator';
import { RepositoryBackedWorkflowStore } from '../../orchestrator/workflow.repository-store';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { DynamoDbOwnershipRepository, DynamoDbWorkflowRepository } from '../../repositories';
import { PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';

const TENANT_ID = 'sisum-default';
const TABLE_NAME = 'fake-workflows-table';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid DynamoDB command input');
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field ${key}`);
  }
  return value;
}

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

  async send(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    await this.latency();

    switch (command.constructor.name) {
      case 'PutCommand': {
        const input = asRecord(command.input);
        const item = asRecord(input.Item);
        const pk = readString(item, 'pk');
        const sk = readString(item, 'sk');
        const k = this.key(pk, sk);
        const condition = input.ConditionExpression;
        if (
          typeof condition === 'string' &&
          condition.includes('attribute_not_exists') &&
          this.items.has(k)
        ) {
          throw this.conditionalCheckFailure();
        }
        this.items.set(k, { ...item });
        return {};
      }

      case 'GetCommand': {
        const input = asRecord(command.input);
        const key = asRecord(input.Key);
        const item = this.items.get(
          this.key(readString(key, 'pk'), readString(key, 'sk'))
        );
        return item ? { Item: { ...item } } : {};
      }

      case 'UpdateCommand': {
        const input = asRecord(command.input);
        const key = asRecord(input.Key);
        const k = this.key(readString(key, 'pk'), readString(key, 'sk'));
        const existing = this.items.get(k);

        if (!existing) {
          throw this.conditionalCheckFailure();
        }

        const expressionAttributeValues = asRecord(
          input.ExpressionAttributeValues ?? {}
        );
        const expectedVersion = expressionAttributeValues[':expectedVersion'];
        if (expectedVersion !== undefined && existing.version !== expectedVersion) {
          throw this.conditionalCheckFailure();
        }

        const updated: Record<string, unknown> = { ...existing };
        const expressionAttributeNames = asRecord(
          input.ExpressionAttributeNames ?? {}
        );
        for (const [namePlaceholder, fieldName] of Object.entries(
          expressionAttributeNames
        )) {
          if (fieldName === 'version') {
            updated.version = (existing.version as number) + 1;
            continue;
          }
          if (fieldName === 'updatedAt') {
            updated.updatedAt = expressionAttributeValues[':updatedAt'];
            continue;
          }
          const match = /^#field(\d+)$/.exec(namePlaceholder);
          if (match) {
            updated[fieldName as string] =
              expressionAttributeValues[`:value${match[1]}`];
          }
        }

        this.items.set(k, updated);
        return { Attributes: { ...updated } };
      }

      case 'DeleteCommand': {
        const input = asRecord(command.input);
        const key = asRecord(input.Key);
        this.items.delete(
          this.key(readString(key, 'pk'), readString(key, 'sk'))
        );
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

function asDocumentClient(table: FakeDynamoTable): DynamoDBDocumentClient {
  return table as unknown as DynamoDBDocumentClient;
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
    const client = asDocumentClient(table);
    const workflowRepository = new DynamoDbWorkflowRepository(client, TABLE_NAME);
    const ownershipRepository = new DynamoDbOwnershipRepository(client, TABLE_NAME);
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
    const client = asDocumentClient(table);
    const workflowRepository = new DynamoDbWorkflowRepository(client, TABLE_NAME);
    const ownershipRepository = new DynamoDbOwnershipRepository(client, TABLE_NAME);
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
      mode: 'demo' as const,
      triggerSource: 'api' as const,
      status: 'running' as const,
      executionState: 'initialized' as const,
      startedAt: new Date().toISOString(),
      completedStages: [],
      failedStages: [],
      retry: createRetryState(3),
    };

    await store.save({ metadata: baseMetadata, context: baseContext });

    // Two "concurrent Lambda invocations" each read the same starting
    // version and try to update the context independently.
    await Promise.all([
      store.updateContext(TENANT_ID, workflowId, {
        ...baseContext,
        currentStage: 'evidence',
      }),
      store.updateContext(TENANT_ID, workflowId, {
        ...baseContext,
        currentStage: 'governance',
      }),
    ]);

    const record = await store.get(TENANT_ID, workflowId);
    assert.ok(record);
    // Both updates applied — version advanced by 2 from the initial save,
    // and no RepositoryConflictError escaped either call.
    assert.equal(record.metadata.version, 3);
  });
});
