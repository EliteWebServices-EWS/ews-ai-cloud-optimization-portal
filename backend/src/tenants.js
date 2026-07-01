const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const ddb    = DynamoDBDocumentClient.from(client);
const TABLE  = process.env.TENANTS_TABLE || "ews-portal-tenants";

// Get all tenants from DynamoDB
async function listTenants() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE }));
  return result.Items || [];
}

// Get one tenant by ID
async function getTenant(id) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { id } })
  );
  return result.Item;
}

// Save a dashboard snapshot back to DynamoDB
async function saveDashboardSnapshot(id, dashboard) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        id,
        dashboardSnapshot: dashboard,
        lastSync: new Date().toISOString()
      }
    })
  );
}

module.exports = { listTenants, getTenant, saveDashboardSnapshot };
