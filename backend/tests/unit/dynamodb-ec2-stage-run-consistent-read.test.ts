import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  ec2CostAnalysisRunSortKey,
  ec2DiscoveryRunSortKey,
  ec2SecurityAnalysisRunSortKey,
} from '../../database';
import { DynamoDbEc2CloudResourceRepository } from '../../repositories/dynamodb/dynamodb-ec2-cloud-resource-repository';
import { DynamoDbEc2CostRepository } from '../../repositories/dynamodb/dynamodb-ec2-cost-repository';
import { DynamoDbEc2SecurityRepository } from '../../repositories/dynamodb/dynamodb-ec2-security-repository';
import { buildStageExecutionOwnerId } from '../../services/ec2-stage-run-execution-metadata';
import {
  Ec2AsyncJobStageCompletionService,
  stageProofIsComplete,
} from '../../services/ec2-async-job-stage-completion';

const TENANT = 'tenant-pd2';
const ACCOUNT = '572262081497';
const TABLE = 'sisum-cloud-resources-test';

function itemKey(pk: string, sk: string): string {
  return `${pk}||${sk}`;
}

function createRunStoreClient(getCommands: GetCommand[]) {
  const store = new Map<string, Record<string, unknown>>();

  return {
    store,
    send: async (command: unknown) => {
      if (command instanceof GetCommand) {
        getCommands.push(command);
        const key = command.input.Key as { pk: string; sk: string };
        const item = store.get(itemKey(key.pk, key.sk));
        return { Item: item ? { ...item } : undefined };
      }

      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        const pk = item.pk as string;
        const sk = item.sk as string;
        const condition = command.input.ConditionExpression;
        const existing = store.get(itemKey(pk, sk));
        if (condition === 'attribute_not_exists(pk)' && existing !== undefined) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        if (condition === '#version = :expected') {
          const expected = command.input.ExpressionAttributeValues?.[':expected'];
          if (!existing || existing.version !== expected) {
            const error = new Error('ConditionalCheckFailedException');
            error.name = 'ConditionalCheckFailedException';
            throw error;
          }
        }
        store.set(itemKey(pk, sk), { ...item });
        return {};
      }

      if (command instanceof UpdateCommand) {
        const key = command.input.Key as { pk: string; sk: string };
        const existing = store.get(itemKey(key.pk, key.sk));
        if (!existing) {
          throw new Error('Item not found');
        }
        const expected = command.input.ExpressionAttributeValues?.[':expected'];
        if (existing.version !== expected) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        const values = command.input.ExpressionAttributeValues ?? {};
        const updated: Record<string, unknown> = {
          ...existing,
          status: values[':status'] ?? existing.status,
          completedAt: values[':completedAt'] ?? existing.completedAt,
          version: Number(existing.version) + 1,
          updatedAt: values[':updatedAt'] ?? existing.updatedAt,
          failureRetryable: values[':failureRetryable'] ?? existing.failureRetryable,
        };
        delete updated.executionOwnerId;
        delete updated.leaseExpiresAt;
        if (values[':counts'] !== undefined) {
          updated.resourceCounts = values[':counts'];
        }
        store.set(itemKey(key.pk, key.sk), updated);
        return {};
      }

      throw new Error(`Unexpected command ${String(command)}`);
    },
  };
}

describe('DynamoDB EC2 stage run consistent read (PD-2)', () => {
  it('discovery getRun requests ConsistentRead when consistentRead:true', async () => {
    const getCommands: GetCommand[] = [];
    const client = createRunStoreClient(getCommands);
    const repo = new DynamoDbEc2CloudResourceRepository(client as never, TABLE);
    const runId = 'job-pd2#discovery';
    const pk = cloudResourceAccountPartitionKey(TENANT, ACCOUNT);
    const sk = ec2DiscoveryRunSortKey(runId);
    client.store.set(itemKey(pk, sk), {
      pk,
      sk,
      entityType: 'EC2_DISCOVERY_RUN',
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T12:00:00.000Z',
      version: 2,
    });

    await repo.getRun(TENANT, ACCOUNT, runId, { consistentRead: true });

    assert.equal(getCommands.length, 1);
    assert.equal(getCommands[0]?.input.ConsistentRead, true);
  });

  it('cost getRun requests ConsistentRead when consistentRead:true', async () => {
    const getCommands: GetCommand[] = [];
    const client = createRunStoreClient(getCommands);
    const repo = new DynamoDbEc2CostRepository(client as never, TABLE);
    const runId = 'job-pd2#cost';
    const pk = cloudResourceAccountPartitionKey(TENANT, ACCOUNT);
    const sk = ec2CostAnalysisRunSortKey(runId);
    client.store.set(itemKey(pk, sk), {
      pk,
      sk,
      entityType: 'EC2_COST_ANALYSIS_RUN',
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T12:00:00.000Z',
      version: 2,
    });

    await repo.getRun(TENANT, ACCOUNT, runId, { consistentRead: true });

    assert.equal(getCommands.length, 1);
    assert.equal(getCommands[0]?.input.ConsistentRead, true);
  });

  it('security getRun requests ConsistentRead when consistentRead:true', async () => {
    const getCommands: GetCommand[] = [];
    const client = createRunStoreClient(getCommands);
    const repo = new DynamoDbEc2SecurityRepository(client as never, TABLE);
    const runId = 'job-pd2#security';
    const pk = cloudResourceAccountPartitionKey(TENANT, ACCOUNT);
    const sk = ec2SecurityAnalysisRunSortKey(runId);
    client.store.set(itemKey(pk, sk), {
      pk,
      sk,
      entityType: 'EC2_SECURITY_ANALYSIS_RUN',
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T12:00:00.000Z',
      version: 2,
    });

    await repo.getRun(TENANT, ACCOUNT, runId, { consistentRead: true });

    assert.equal(getCommands.length, 1);
    assert.equal(getCommands[0]?.input.ConsistentRead, true);
  });

  it('discovery getRun omits ConsistentRead by default', async () => {
    const getCommands: GetCommand[] = [];
    const client = createRunStoreClient(getCommands);
    const repo = new DynamoDbEc2CloudResourceRepository(client as never, TABLE);

    await repo.getRun(TENANT, ACCOUNT, 'missing-run');

    assert.equal(getCommands.length, 1);
    assert.equal(getCommands[0]?.input.ConsistentRead, undefined);
  });

  it('discovery completion proof reads completed run immediately after completeRun', async () => {
    const getCommands: GetCommand[] = [];
    const client = createRunStoreClient(getCommands);
    const discoveryRuns = new DynamoDbEc2CloudResourceRepository(client as never, TABLE);
    const runId = 'job-pd2-proof#discovery';
    const nowMs = Date.parse('2026-08-15T12:00:00.000Z');
    const claimed = await discoveryRuns.claimExecution({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: new Date(nowMs).toISOString(),
      nowMs,
      executionOwnerIdForAttempt: (attempt) =>
        buildStageExecutionOwnerId('job-pd2-proof', 'discovery', attempt),
    });
    assert.equal(claimed.status, 'RUNNING');

    await discoveryRuns.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: claimed.version,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T12:05:00.000Z',
      resourceCounts: { INSTANCE: 1 },
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });

    getCommands.length = 0;
    const stageCompletion = new Ec2AsyncJobStageCompletionService(
      discoveryRuns,
      {} as never,
      {} as never,
      () => nowMs,
    );
    const proof = await stageCompletion.discoveryRunProof(TENANT, ACCOUNT, runId);

    assert.equal(getCommands.length, 1);
    assert.equal(getCommands[0]?.input.ConsistentRead, true);
    assert.equal(proof.state, 'complete');
    assert.equal(stageProofIsComplete(proof), true);
  });
});
