import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from './harness';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'sisum-learning-production';
const TENANT_A = 'validation-tenant-a';
const TENANT_B = 'validation-tenant-b';
const ITEM_KEY = {
  pk: `TENANT#${TENANT_A}`,
  sk: 'LEARNING#workflow-validation-001',
};

async function cleanupItem() {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: ITEM_KEY,
    })
  );
}

describe('Learning table deep validation', () => {
  afterEach(async () => {
    await cleanupItem();
  });

  it('rejects duplicate creation with attribute_not_exists condition', async () => {
    const initialItem = {
      ...ITEM_KEY,
      tenantId: TENANT_A,
      status: 'ACTIVE',
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: initialItem,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      })
    );

    let errorThrown = false;
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...ITEM_KEY,
            tenantId: TENANT_A,
            status: 'UPDATED',
            version: 1,
            updatedAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        })
      );
    } catch (error: unknown) {
      errorThrown = true;
      assert.equal((error as { name?: string }).name, 'ConditionalCheckFailedException');
    }

    assert.equal(errorThrown, true, 'Duplicate item creation should fail with conditional write');
  });

  it('detects stale version updates using conditional version control', async () => {
    const initialItem = {
      ...ITEM_KEY,
      tenantId: TENANT_A,
      status: 'ACTIVE',
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: initialItem,
      })
    );

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: ITEM_KEY,
        UpdateExpression: 'SET #status = :status, version = :newVersion, updatedAt = :updatedAt',
        ConditionExpression: 'version = :expectedVersion',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'UPDATED',
          ':newVersion': 2,
          ':updatedAt': new Date().toISOString(),
          ':expectedVersion': 1,
        },
      })
    );

    let conflictError = false;
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: ITEM_KEY,
          UpdateExpression: 'SET #status = :status, version = :newVersion, updatedAt = :updatedAt',
          ConditionExpression: 'version = :expectedVersion',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'STALE_UPDATE',
            ':newVersion': 3,
            ':updatedAt': new Date().toISOString(),
            ':expectedVersion': 1,
          },
        })
      );
    } catch (error: unknown) {
      conflictError = true;
      assert.equal((error as { name?: string }).name, 'ConditionalCheckFailedException');
    }

    assert.equal(conflictError, true, 'Stale version update should fail as a conditional conflict');
  });

  it('allows one conditional update and rejects the stale concurrent attempt', async () => {
    const initialItem = {
      ...ITEM_KEY,
      tenantId: TENANT_A,
      status: 'ACTIVE',
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: initialItem,
      })
    );

    const firstUpdate = docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: ITEM_KEY,
        UpdateExpression: 'SET #status = :status, version = :newVersion, updatedAt = :updatedAt',
        ConditionExpression: 'version = :expectedVersion',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'CONCURRENT_ONE',
          ':newVersion': 2,
          ':updatedAt': new Date().toISOString(),
          ':expectedVersion': 1,
        },
      })
    );

    const secondUpdate = docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: ITEM_KEY,
        UpdateExpression: 'SET #status = :status, version = :newVersion, updatedAt = :updatedAt',
        ConditionExpression: 'version = :expectedVersion',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'CONCURRENT_TWO',
          ':newVersion': 2,
          ':updatedAt': new Date().toISOString(),
          ':expectedVersion': 1,
        },
      })
    );

    const results = await Promise.allSettled([firstUpdate, secondUpdate]);
    const successCount = results.filter((result) => result.status === 'fulfilled').length;
    const failureCount = results.filter((result) => result.status === 'rejected').length;

    assert.equal(successCount, 1, 'Exactly one concurrent conditional update should succeed');
    assert.equal(failureCount, 1, 'Exactly one concurrent conditional update should fail');

    const finalized = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: ITEM_KEY,
      })
    );

    assert.ok(finalized.Item, 'Updated item must exist');
    assert.equal(finalized.Item?.version, 2);
  });
});
