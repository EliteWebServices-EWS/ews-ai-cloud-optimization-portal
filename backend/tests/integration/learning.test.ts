import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "./harness";

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "sisum-learning-production";
const TEST_TENANT_ID = "default-tenant";

async function runIntegrationTest() {
  console.log(`Running integration tests against table: ${TABLE_NAME}...`);

  const testItem = {
    pk: `TENANT#${TEST_TENANT_ID}`,
    sk: "LEARNING#module-101",
    tenantId: TEST_TENANT_ID,
    title: "AWS Serverless Deep Dive",
    completed: false,
  };

  try {
    // 1. Put Item
    const putRes = await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: testItem,
      })
    );
    console.log("✔ PutItem successful, status:", putRes.$metadata.httpStatusCode);

    // 2. Get Item
    const getRes = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: testItem.pk,
          sk: testItem.sk,
        },
      })
    );
    if (!getRes.Item || getRes.Item.title !== testItem.title) {
      throw new Error("GetItem failed or title mismatched");
    }
    console.log("✔ GetItem successful:", getRes.Item.title);

    // 3. Delete Item
    const delRes = await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: testItem.pk,
          sk: testItem.sk,
        },
      })
    );
    console.log("✔ DeleteItem cleanup successful, status:", delRes.$metadata.httpStatusCode);

    console.log("\n✅ ALL INTEGRATION TESTS PASSED SUCCESSFULLY!");
  } catch (error) {
    console.error("❌ Integration Test Failed:", error);
    process.exit(1);
  }
}

runIntegrationTest();