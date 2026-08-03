import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  TENANT_OWNER_BOOTSTRAP_SORT_KEY,
  membershipSortKey,
  tenantPartitionKey,
} from '../../../database';
import { DynamoDbMembershipRepository } from '../../../repositories/dynamodb/dynamodb-membership-repository';
import { FakeDocumentClient } from '../support/fake-persistence-table';

describe('DynamoDbMembershipRepository.bootstrapFirstOwner hardening', () => {
  it('queries tenant partition for MEMBER# before TransactWrite', async () => {
    const fake = new FakeDocumentClient();
    const repo = new DynamoDbMembershipRepository(
      fake as unknown as DynamoDBDocumentClient,
      'memberships-test',
    );

    const commands: unknown[] = [];
    const originalSend = fake.send.bind(fake);
    fake.send = async (command: unknown) => {
      commands.push(command);
      return originalSend(command);
    };

    await repo.bootstrapFirstOwner({
      tenantId: 'sisum-default',
      userId: 'cognito-sub-1',
      memberId: 'mem-bootstrap-1',
    });

    const queryIndex = commands.findIndex(
      (command) => command instanceof QueryCommand,
    );
    const transactIndex = commands.findIndex(
      (command) => command instanceof TransactWriteCommand,
    );

    assert.ok(queryIndex >= 0);
    assert.ok(transactIndex > queryIndex);

    const query = commands[queryIndex] as QueryCommand;
    assert.match(
      query.input.KeyConditionExpression ?? '',
      /begins_with\(#sk, :memberPrefix\)/,
    );
    assert.equal(query.input.Limit, 1);
    assert.equal(query.input.ConsistentRead, true);
    assert.equal(
      commands.some((command) => command instanceof ScanCommand),
      false,
    );
  });

  it('legacy MEMBER# item without OWNER_BOOTSTRAP marker rejects bootstrap', async () => {
    const fake = new FakeDocumentClient();
    const repo = new DynamoDbMembershipRepository(
      fake as unknown as DynamoDBDocumentClient,
      'memberships-test',
    );

    const now = new Date().toISOString();
    await fake.send(
      new PutCommand({
        TableName: 'memberships-test',
        Item: {
          pk: tenantPartitionKey('legacy-tenant'),
          sk: membershipSortKey('legacy-user'),
          entityType: 'MEMBERSHIP',
          tenantId: 'legacy-tenant',
          userId: 'legacy-user',
          memberId: 'mem-legacy',
          role: 'tenant_admin',
          status: 'SUSPENDED',
          joinedAt: now,
          statusChangedAt: now,
          version: 1,
          createdAt: now,
          updatedAt: now,
          gsi1pk: 'USER#legacy-user',
          gsi1sk: `${tenantPartitionKey('legacy-tenant')}#${membershipSortKey('legacy-user')}`,
          gsi2pk: 'MEMBERID#mem-legacy',
          gsi2sk: 'MEMBER',
        },
      }),
    );

    const commands: unknown[] = [];
    const originalSend = fake.send.bind(fake);
    fake.send = async (command: unknown) => {
      commands.push(command);
      return originalSend(command);
    };

    await assert.rejects(
      () =>
        repo.bootstrapFirstOwner({
          tenantId: 'legacy-tenant',
          userId: 'new-admin',
          memberId: 'mem-new',
        }),
      (error: unknown) =>
        error instanceof Error && error.name === 'TenantOwnerBootstrapConflictError',
    );

    assert.equal(
      commands.some((command) => command instanceof TransactWriteCommand),
      false,
    );
    assert.equal(
      fake.store.has(
        `${tenantPartitionKey('legacy-tenant')}||${TENANT_OWNER_BOOTSTRAP_SORT_KEY}`,
      ),
      false,
    );
  });

  it('second bootstrap attempt fails with conflict after marker exists', async () => {
    const fake = new FakeDocumentClient();
    const repo = new DynamoDbMembershipRepository(
      fake as unknown as DynamoDBDocumentClient,
      'memberships-test',
    );

    await repo.bootstrapFirstOwner({
      tenantId: 'sisum-default',
      userId: 'user-a',
      memberId: 'mem-1',
    });

    await assert.rejects(
      () =>
        repo.bootstrapFirstOwner({
          tenantId: 'sisum-default',
          userId: 'user-b',
          memberId: 'mem-2',
        }),
      (error: unknown) =>
        error instanceof Error && error.name === 'TenantOwnerBootstrapConflictError',
    );
  });
});
