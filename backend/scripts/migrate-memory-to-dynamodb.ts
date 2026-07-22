import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../tests/integration/harness";

// Target table name matching SAM template setup
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "sisum-learning-production";

// Default tenant data to seed into DynamoDB
const defaultTenantData = [
  {
    pk: "TENANT#default-tenant",
    sk: "CONFIG#settings",
    tenantId: "default-tenant",
    status: "ACTIVE",
    updatedAt: new Date().toISOString(),
  },
];

async function runMigration(): Promise<void> {
  console.log(`Starting migration to DynamoDB table: ${TABLE_NAME}...`);

  const params = {
    RequestItems: {
      [TABLE_NAME]: defaultTenantData.map((item) => ({
        PutRequest: { Item: item },
      })),
    },
  };

  try {
    const command = new BatchWriteCommand(params);
    await docClient.send(command);
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();