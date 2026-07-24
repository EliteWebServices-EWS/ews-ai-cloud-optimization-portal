import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './harness';

// Guard: only run against an explicitly configured local/test DynamoDB endpoint.
// Never fall back to a production table name or run with ambient AWS credentials.
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const canRun = Boolean(DYNAMODB_ENDPOINT && TABLE_NAME);

const BENCH_TENANT = 'integration-test-tenant-bench';

describe('Performance, concurrency, and validation benchmarks (DynamoDB)', () => {
  it('validates cold start, concurrency, pagination, isolation, and conditional writes', { skip: !canRun }, async () => {
    if (!canRun) return;

    // 1. Cold Start / First Connection Latency
    const startCold = performance.now();
    await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${BENCH_TENANT}` },
        Limit: 1,
      })
    );
    const coldLatency = performance.now() - startCold;
    console.log(`Cold start query latency: ${coldLatency.toFixed(2)}ms`);

    // 2. Concurrent Writes / Race Condition Simulation
    const concurrentCount = 10;
    const startConcurrent = performance.now();
    await Promise.all(
      Array.from({ length: concurrentCount }).map((_, idx) =>
        docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              pk: `TENANT#${BENCH_TENANT}`,
              sk: `BENCH#item-${idx}`,
              tenantId: BENCH_TENANT,
              payload: `Concurrent test record ${idx}`,
              version: 1,
            },
          })
        )
      )
    );
    const concurrentDuration = performance.now() - startConcurrent;
    console.log(`Executed ${concurrentCount} concurrent writes in ${concurrentDuration.toFixed(2)}ms`);

    // 3. Pagination / Throughput
    const page1 = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${BENCH_TENANT}` },
        Limit: 5,
      })
    );
    assert.ok((page1.Items?.length ?? 0) > 0);

    // 4. Cross-Tenant Isolation Check
    const isolationCheck = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'TENANT#non-existent-tenant' },
      })
    );
    assert.equal(isolationCheck.Items?.length ?? 0, 0);

    // 5. Conditional Write / Version Conflict Handling
    let conditionalCheckFailed = false;
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: `TENANT#${BENCH_TENANT}`, sk: 'BENCH#item-0', tenantId: BENCH_TENANT },
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      );
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'name' in err &&
        err.name === 'ConditionalCheckFailedException'
      ) {
        conditionalCheckFailed = true;
      }
    }
    assert.equal(conditionalCheckFailed, true);

    // Cleanup
    await Promise.all(
      Array.from({ length: concurrentCount }).map((_, idx) =>
        docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk: `TENANT#${BENCH_TENANT}`, sk: `BENCH#item-${idx}` },
          })
        )
      )
    );
  });
});

if (!canRun) {
  console.log(
    'Performance/validation benchmark skipped: set DYNAMODB_ENDPOINT and DYNAMODB_TABLE_NAME ' +
      '(e.g. pointing at DynamoDB Local) to run this against real DynamoDB. ' +
      'This test intentionally never defaults to a production table.'
  );
}
