import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

export interface CreateAwsAccountsTableOptions {
  tableName: string;
  endpoint?: string;
  region: string;
}

export function parseCreateAwsAccountsTableEnv(
  env: NodeJS.ProcessEnv = process.env,
): CreateAwsAccountsTableOptions {
  const tableName =
    env.AWS_ACCOUNTS_TABLE_NAME?.trim() ||
    env.DYNAMODB_TABLE_NAME?.trim() ||
    'sisum-aws-accounts-validation';

  const region = env.AWS_REGION?.trim() || 'us-east-1';
  const endpoint = env.DYNAMODB_ENDPOINT?.trim() || undefined;

  return { tableName, region, endpoint };
}

function isResourceInUseException(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResourceInUseException';
}

export function buildAwsAccountsCreateTableInput(tableName: string) {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST' as const,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' as const },
      { AttributeName: 'sk', AttributeType: 'S' as const },
      { AttributeName: 'gsi1pk', AttributeType: 'S' as const },
      { AttributeName: 'gsi1sk', AttributeType: 'S' as const },
      { AttributeName: 'gsi2pk', AttributeType: 'S' as const },
      { AttributeName: 'gsi2sk', AttributeType: 'S' as const },
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
      {
        IndexName: 'gsi2',
        KeySchema: [
          { AttributeName: 'gsi2pk', KeyType: 'HASH' as const },
          { AttributeName: 'gsi2sk', KeyType: 'RANGE' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  };
}

export async function createAwsAccountsTable(
  client: DynamoDBClient,
  options: CreateAwsAccountsTableOptions,
): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand(buildAwsAccountsCreateTableInput(options.tableName)),
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
    throw new Error(
      `AWS accounts table ${options.tableName} is not ACTIVE.`,
    );
  }
}
