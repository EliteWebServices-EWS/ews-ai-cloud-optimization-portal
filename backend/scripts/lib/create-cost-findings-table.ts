import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

export interface CreateCostFindingsTableOptions {
  tableName: string;
  endpoint?: string;
  region: string;
}

export function parseCreateCostFindingsTableEnv(
  env: NodeJS.ProcessEnv = process.env,
): CreateCostFindingsTableOptions {
  const tableName =
    env.COST_FINDINGS_TABLE_NAME?.trim() ||
    env.DYNAMODB_TABLE_NAME?.trim() ||
    'sisum-cost-findings-validation';

  const region = env.AWS_REGION?.trim() || 'us-east-1';
  const endpoint = env.DYNAMODB_ENDPOINT?.trim() || undefined;

  return { tableName, region, endpoint };
}

function isResourceInUseException(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResourceInUseException';
}

export function buildCostFindingsCreateTableInput(tableName: string) {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST' as const,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' as const },
      { AttributeName: 'sk', AttributeType: 'S' as const },
      { AttributeName: 'gsi1pk', AttributeType: 'S' as const },
      { AttributeName: 'gsi1sk', AttributeType: 'S' as const },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' as const },
      { AttributeName: 'sk', KeyType: 'RANGE' as const },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'gsi1',
        KeySchema: [
          { AttributeName: 'gsi1pk', KeyType: 'HASH' as const },
          { AttributeName: 'gsi1sk', KeyType: 'RANGE' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  };
}

export async function createCostFindingsTable(
  client: DynamoDBClient,
  options: CreateCostFindingsTableOptions,
): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand(buildCostFindingsCreateTableInput(options.tableName)),
    );
  } catch (error) {
    if (!isResourceInUseException(error)) {
      throw error;
    }
  }

  await waitUntilTableExists(
    { client, maxWaitTime: 60 },
    { TableName: options.tableName },
  );

  const described = await client.send(
    new DescribeTableCommand({ TableName: options.tableName }),
  );

  if (described.Table?.TableStatus !== 'ACTIVE') {
    throw new Error(`Cost findings table ${options.tableName} is not ACTIVE.`);
  }
}
