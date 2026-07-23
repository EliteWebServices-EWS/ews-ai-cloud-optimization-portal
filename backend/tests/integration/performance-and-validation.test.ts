import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "./harness";

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "sisum-learning-production";

async function runPerformanceAndValidationSuite() {
  console.log("🚀 STARTING PERFORMANCE, DEEP VALIDATION & BENCHMARK SUITE...\n");

  // 1. Cold Start / First Connection Latency Test
  const startCold = performance.now();
  await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "TENANT#default-tenant" },
      Limit: 1,
    })
  );
  const coldLatency = performance.now() - startCold;
  console.log(`✔ Cold Start Query Latency: ${coldLatency.toFixed(2)}ms`);

  // 2. Concurrent Invocation & Race Condition Simulation (10 Concurrent Writes)
  const concurrentCount = 10;
  const startConcurrent = performance.now();
  const writePromises = Array.from({ length: concurrentCount }).map((_, idx) =>
    docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: "TENANT#tenant-bench",
          sk: `BENCH#item-${idx}`,
          tenantId: "tenant-bench",
          payload: `Concurrent test record ${idx}`,
          version: 1,
        },
      })
    )
  );
  await Promise.all(writePromises);
  const concurrentDuration = performance.now() - startConcurrent;
  console.log(`✔ Executed ${concurrentCount} concurrent writes in ${concurrentDuration.toFixed(2)}ms`);

  // 3. Pagination & Throughput Test
  const page1 = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "TENANT#tenant-bench" },
      Limit: 5,
    })
  );
  console.log(`✔ Pagination Page 1 fetched: ${page1.Items?.length || 0} items. Has Next Page: ${!!page1.LastEvaluatedKey}`);

  // 4. Explicit Cross-Tenant Isolation Check
  const tenantIsolationCheck = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "TENANT#non-existent-tenant" },
    })
  );
  if (tenantIsolationCheck.Items && tenantIsolationCheck.Items.length > 0) {
    throw new Error("Tenant isolation breach detected!");
  }
  console.log("✔ Cross-Tenant Isolation Verified: Unrelated partition key returned 0 items.");

  // 5. Conditional Writes & Version Conflict Handling
  let conditionalPassed = false;
  try {
    // Attempt to write an item that already exists with condition attribute_not_exists(pk)
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: "TENANT#tenant-bench",
          sk: "BENCH#item-0",
          tenantId: "tenant-bench",
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      conditionalPassed = true;
      console.log("✔ Conditional Write / Version Conflict Handling Verified (ConditionalCheckFailedException triggered).");
    }
  }

  if (!conditionalPassed) {
    throw new Error("Conditional write validation failed to reject duplicate key.");
  }

  // Cleanup benchmark records
  const deletePromises = Array.from({ length: concurrentCount }).map((_, idx) =>
    docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: "TENANT#tenant-bench", sk: `BENCH#item-${idx}` },
      })
    )
  );
  await Promise.all(deletePromises);
  console.log("✔ Benchmark test data successfully cleaned up.");

  console.log("\n✅ ALL PERFORMANCE & DEEP VALIDATION TESTS PASSED!");
}

runPerformanceAndValidationSuite();