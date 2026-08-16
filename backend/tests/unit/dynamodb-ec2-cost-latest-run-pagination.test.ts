import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  ec2CostAnalysisRunSortKey,
  EC2_COST_ANALYSIS_RUN_SK_PREFIX,
} from '../../database';
import type { Ec2CostAnalysisRunRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { DynamoDbEc2CostRepository } from '../../repositories/dynamodb/dynamodb-ec2-cost-repository';

const TABLE = 'sisum-cloud-resources-test';
const TENANT_A = 'tenant-a';
const ACCOUNT_A = '111122223333';
const TENANT_B = 'tenant-b';
const PK_A = cloudResourceAccountPartitionKey(TENANT_A, ACCOUNT_A);

interface QueryPage {
  Items: Record<string, unknown>[];
  LastEvaluatedKey?: Record<string, unknown>;
}

interface PaginatedQueryClient {
  commands: QueryCommand[];
  send(command: unknown): Promise<unknown>;
}

function buildCostRunItem(
  run: Pick<
    Ec2CostAnalysisRunRecord,
    'runId' | 'tenantId' | 'accountId' | 'regions' | 'status' | 'completedAt'
  > &
    Partial<Ec2CostAnalysisRunRecord>,
): Record<string, unknown> {
  const now = '2026-08-15T00:00:00.000Z';
  return {
    pk: cloudResourceAccountPartitionKey(run.tenantId, run.accountId),
    sk: ec2CostAnalysisRunSortKey(run.runId),
    entityType: 'EC2_COST_ANALYSIS_RUN',
    observationDays: 14,
    periodSeconds: 3600,
    requestedAt: now,
    startedAt: now,
    instancesFound: 1,
    instancesEvaluated: 1,
    recommendationsCreated: 0,
    recommendationsUpdated: 0,
    recommendationsResolved: 0,
    insufficientDataCount: 0,
    regionsSucceeded: run.regions,
    regionsFailed: [],
    warnings: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...run,
  };
}

function createPaginatedQueryClient(pages: QueryPage[]): PaginatedQueryClient {
  let pageIndex = 0;

  return {
    commands: [],
    async send(command: unknown): Promise<unknown> {
      if (!(command instanceof QueryCommand)) {
        throw new Error(`Unexpected command ${String(command)}`);
      }

      this.commands.push(command);

      const page = pages[pageIndex];
      if (!page) {
        throw new Error(`No Query page configured for request ${pageIndex + 1}`);
      }

      pageIndex += 1;
      return page;
    },
  };
}

function assertBaseQuery(command: QueryCommand): void {
  assert.equal(command.input.TableName, TABLE);
  assert.equal(
    command.input.KeyConditionExpression,
    'pk = :pk AND begins_with(sk, :prefix)',
  );
  assert.equal(command.input.ExpressionAttributeValues?.[':pk'], PK_A);
  assert.equal(
    command.input.ExpressionAttributeValues?.[':prefix'],
    EC2_COST_ANALYSIS_RUN_SK_PREFIX,
  );
}

describe('DynamoDbEc2CostRepository getLatestCompletedRun pagination', () => {
  it('returns the newest SUCCEEDED run from the second Query page', async () => {
    const page1LastKey = { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-page-1') };
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-old-page-1',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-14T01:00:00.000Z',
          }),
        ],
        LastEvaluatedKey: page1LastKey,
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-new-page-2',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest?.runId, 'run-new-page-2');
    assert.equal(client.commands.length, 2);
    assertBaseQuery(client.commands[0]!);
    assert.equal(client.commands[0]!.input.ExclusiveStartKey, undefined);
    assertBaseQuery(client.commands[1]!);
    assert.deepEqual(client.commands[1]!.input.ExclusiveStartKey, page1LastKey);
  });

  it('finds a requested region that only appears on the second Query page', async () => {
    const page1LastKey = { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-west-only') };
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-west-only',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-west-2'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-16T01:00:00.000Z',
          }),
        ],
        LastEvaluatedKey: page1LastKey,
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-east-page-2',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest?.runId, 'run-east-page-2');
  });

  it('ignores FAILED, RUNNING, malformed completedAt, and missing completedAt', async () => {
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-failed-later',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'FAILED',
            completedAt: '2026-08-20T01:00:00.000Z',
          }),
          buildCostRunItem({
            runId: 'run-running-later',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'RUNNING',
            completedAt: '2026-08-19T01:00:00.000Z',
          }),
          buildCostRunItem({
            runId: 'run-malformed-completed-at',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: 'not-a-date',
          }),
          buildCostRunItem({
            runId: 'run-missing-completed-at',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: undefined,
          }),
        ],
        LastEvaluatedKey: { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-page-1') },
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-valid-winner',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'PARTIAL',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest?.runId, 'run-valid-winner');
    assert.equal(latest?.status, 'PARTIAL');
  });

  it('selects the greatest completedAt across three qualifying runs on multiple pages', async () => {
    const page1LastKey = { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-page-1-a') };
    const page2LastKey = { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-page-2-a') };
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-page-1-a',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-13T01:00:00.000Z',
          }),
          buildCostRunItem({
            runId: 'run-page-1-b',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-14T01:00:00.000Z',
          }),
        ],
        LastEvaluatedKey: page1LastKey,
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-page-2-a',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-16T01:00:00.000Z',
          }),
        ],
        LastEvaluatedKey: page2LastKey,
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-page-3-a',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest?.runId, 'run-page-2-a');
    assert.equal(client.commands.length, 3);
    assert.equal(client.commands[0]!.input.ExclusiveStartKey, undefined);
    assert.deepEqual(client.commands[1]!.input.ExclusiveStartKey, page1LastKey);
    assert.deepEqual(client.commands[2]!.input.ExclusiveStartKey, page2LastKey);
  });

  it('queries only the requested tenant/account partition key', async () => {
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-other-tenant',
            tenantId: TENANT_B,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-20T01:00:00.000Z',
          }),
          buildCostRunItem({
            runId: 'run-target-tenant',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest?.runId, 'run-target-tenant');
    assert.equal(client.commands.length, 1);
    assertBaseQuery(client.commands[0]!);
  });

  it('returns null when no page includes the requested region', async () => {
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-west-page-1',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-west-2'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
        LastEvaluatedKey: { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-west-page-1') },
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-west-page-2',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['eu-west-1'],
            status: 'SUCCEEDED',
            completedAt: '2026-08-16T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest, null);
    assert.equal(client.commands.length, 2);
  });

  it('returns null when no eligible completed run exists across all pages', async () => {
    const client = createPaginatedQueryClient([
      {
        Items: [
          buildCostRunItem({
            runId: 'run-running',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'RUNNING',
            completedAt: '2026-08-15T01:00:00.000Z',
          }),
        ],
        LastEvaluatedKey: { pk: PK_A, sk: ec2CostAnalysisRunSortKey('run-running') },
      },
      {
        Items: [
          buildCostRunItem({
            runId: 'run-failed',
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            regions: ['us-east-1'],
            status: 'FAILED',
            completedAt: '2026-08-16T01:00:00.000Z',
          }),
        ],
      },
    ]);

    const repository = new DynamoDbEc2CostRepository(
      client as unknown as DynamoDBDocumentClient,
      TABLE,
    );

    const latest = await repository.getLatestCompletedRun({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
    });

    assert.equal(latest, null);
    assert.equal(client.commands.length, 2);
  });
});
