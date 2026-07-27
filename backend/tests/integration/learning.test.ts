import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './harness';

// Guard: only run against an explicitly configured local/test DynamoDB endpoint.
// Never fall back to a production table name or run with ambient AWS credentials.
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const canRun = Boolean(DYNAMODB_ENDPOINT && TABLE_NAME);

const TEST_TENANT_ID = 'integration-test-tenant-learning';

describe('Learning table integration (DynamoDB)', () => {
  it('puts, gets, and deletes a learning record against a test table', { skip: !canRun }, async () => {
    if (!canRun) return;

    const testItem = {
      pk: `TENANT#${TEST_TENANT_ID}`,
      sk: 'LEARNING#module-101',
      tenantId: TEST_TENANT_ID,
      title: 'AWS Serverless Deep Dive',
      completed: false,
    };

    const putRes = await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: testItem,
      })
    );
    assert.equal(putRes.$metadata.httpStatusCode, 200);

    const getRes = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: testItem.pk, sk: testItem.sk },
      })
    );
    assert.ok(getRes.Item);
    assert.equal(getRes.Item?.title, testItem.title);

    const delRes = await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: testItem.pk, sk: testItem.sk },
      })
    );
    assert.equal(delRes.$metadata.httpStatusCode, 200);
  });
});

if (!canRun) {
  console.log(
    'Learning table integration test skipped: set DYNAMODB_ENDPOINT and DYNAMODB_TABLE_NAME ' +
      '(e.g. pointing at DynamoDB Local) to run this against real DynamoDB. ' +
      'This test intentionally never defaults to a production table.'
  );
}
