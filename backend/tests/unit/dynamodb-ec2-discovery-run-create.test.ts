import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  cloudResourceSortKey,
  ec2DiscoveryRunSortKey,
} from '../../database';
import { DynamoDbEc2CloudResourceRepository } from '../../repositories/dynamodb/dynamodb-ec2-cloud-resource-repository';
import { buildStageExecutionOwnerId } from '../../services/ec2-stage-run-execution-metadata';

const TENANT = 'tenant-ddb-discovery';
const ACCOUNT = '572262081497';
const TABLE = 'sisum-cloud-resources-test';

function itemKey(pk: string, sk: string): string {
  return `${pk}||${sk}`;
}

/** Minimal PutItem store: conditions are evaluated only for the requested primary key (pk + sk). */
function createCompositeKeyDocumentClient() {
  const store = new Map<string, Record<string, unknown>>();

  return {
    store,
    send: async (command: unknown) => {
      if (command instanceof GetCommand) {
        const key = command.input.Key as { pk: string; sk: string };
        const item = store.get(itemKey(key.pk, key.sk));
        return { Item: item ? { ...item } : undefined };
      }

      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        const pk = item.pk as string;
        const sk = item.sk as string;
        const key = itemKey(pk, sk);
        const existing = store.get(key);
        const condition = command.input.ConditionExpression;

        if (condition === 'attribute_not_exists(pk)' && existing !== undefined) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }

        store.set(key, { ...item });
        return {};
      }

      throw new Error(`Unexpected command ${String(command)}`);
    },
  };
}

describe('DynamoDbEc2CloudResourceRepository discovery run create', () => {
  it('createRun uses attribute_not_exists(pk) create-if-absent on the composite key', async () => {
    const puts: PutCommand[] = [];
    const client = {
      send: async (command: unknown) => {
        if (command instanceof PutCommand) {
          puts.push(command);
          return {};
        }
        if (command instanceof GetCommand) {
          return { Item: undefined };
        }
        throw new Error(`Unexpected command ${String(command)}`);
      },
    };

    const repo = new DynamoDbEc2CloudResourceRepository(client as never, TABLE);
    const runId = 'job-idem-test#discovery';
    await repo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: '2026-07-30T12:00:00.000Z',
      executionOwnerId: buildStageExecutionOwnerId('job-idem-test', 'discovery', 1),
      leaseExpiresAt: '2026-07-30T12:05:00.000Z',
      attemptCount: 1,
    });

    assert.equal(puts.length, 1);
    assert.equal(puts[0].input.ConditionExpression, 'attribute_not_exists(pk)');
    assert.equal(
      puts[0].input.Item?.sk,
      ec2DiscoveryRunSortKey(runId),
    );
  });

  it('attribute_not_exists(pk) allows a second item with the same pk and different sk', async () => {
    const client = createCompositeKeyDocumentClient();
    const pk = cloudResourceAccountPartitionKey(TENANT, ACCOUNT);
    const resourceSk = cloudResourceSortKey('us-east-1', 'INSTANCE', 'i-existing');
    const runId = 'job-idem-second#discovery';
    const runSk = ec2DiscoveryRunSortKey(runId);

    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk, sk: resourceSk, entityType: 'CLOUD_RESOURCE' },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );

    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk, sk: runSk, entityType: 'EC2_DISCOVERY_RUN', runId },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );

    assert.equal(client.store.size, 2);
    assert.ok(client.store.has(itemKey(pk, resourceSk)));
    assert.ok(client.store.has(itemKey(pk, runSk)));
  });

  it('attribute_not_exists(pk) rejects overwrite of the same pk and sk', async () => {
    const client = createCompositeKeyDocumentClient();
    const pk = cloudResourceAccountPartitionKey(TENANT, ACCOUNT);
    const runSk = ec2DiscoveryRunSortKey('job-dup#discovery');

    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk, sk: runSk, version: 1 },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );

    await assert.rejects(
      () =>
        client.send(
          new PutCommand({
            TableName: TABLE,
            Item: { pk, sk: runSk, version: 2 },
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        ),
      (error: unknown) =>
        error instanceof Error && error.name === 'ConditionalCheckFailedException',
    );
  });

  it('claimExecution on missing run writes discovery run with expected pk/sk', async () => {
    const client = createCompositeKeyDocumentClient();
    client.store.set(
      itemKey(
        cloudResourceAccountPartitionKey(TENANT, ACCOUNT),
        cloudResourceSortKey('us-east-1', 'INSTANCE', 'i-existing'),
      ),
      { pk: cloudResourceAccountPartitionKey(TENANT, ACCOUNT), sk: 'existing' },
    );

    const repo = new DynamoDbEc2CloudResourceRepository(client as never, TABLE);
    const runId = 'job-new#discovery';
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const claimed = await repo.claimExecution({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: new Date(nowMs).toISOString(),
      nowMs,
      executionOwnerIdForAttempt: (attempt) =>
        buildStageExecutionOwnerId('job-new', 'discovery', attempt),
    });

    assert.equal(claimed.runId, runId);
    assert.equal(claimed.status, 'RUNNING');
    assert.ok(
      client.store.has(
        itemKey(
          cloudResourceAccountPartitionKey(TENANT, ACCOUNT),
          ec2DiscoveryRunSortKey(runId),
        ),
      ),
    );
  });
});
