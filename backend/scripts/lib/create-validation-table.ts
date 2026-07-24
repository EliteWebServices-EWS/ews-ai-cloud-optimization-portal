import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

export interface CreateValidationTableOptions {
  tableName: string;
  endpoint?: string;
  region: string;
}

export function assertCreateValidationTableOptions(
  options: CreateValidationTableOptions,
): void {
  if (!options.tableName.trim()) {
    throw new Error('DYNAMODB_TABLE_NAME must be a non-empty string.');
  }
  if (!options.region.trim()) {
    throw new Error('AWS_REGION must be a non-empty string.');
  }
}

export function parseCreateValidationTableEnv(
  env: NodeJS.ProcessEnv = process.env,
): CreateValidationTableOptions {
  const tableNameFromEnv = env.DYNAMODB_TABLE_NAME;
  const regionFromEnv = env.AWS_REGION;

  if (tableNameFromEnv !== undefined && tableNameFromEnv.trim().length === 0) {
    throw new Error('DYNAMODB_TABLE_NAME must be a non-empty string.');
  }
  if (regionFromEnv !== undefined && regionFromEnv.trim().length === 0) {
    throw new Error('AWS_REGION must be a non-empty string.');
  }

  const options: CreateValidationTableOptions = {
    tableName: tableNameFromEnv?.trim() || 'sisum-sprint11-validation',
    region: regionFromEnv?.trim() || 'us-east-1',
    endpoint: env.DYNAMODB_ENDPOINT?.trim() || undefined,
  };

  assertCreateValidationTableOptions(options);
  return options;
}

function isResourceInUseException(error: unknown): boolean {
  return (
    error instanceof Error && error.name === 'ResourceInUseException'
  );
}

function buildCreateTableInput(tableName: string) {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST' as const,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' as const },
      { AttributeName: 'sk', AttributeType: 'S' as const },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' as const },
      { AttributeName: 'sk', KeyType: 'RANGE' as const },
    ],
  };
}

export async function createValidationTable(
  client: DynamoDBClient,
  options: CreateValidationTableOptions,
): Promise<void> {
  assertCreateValidationTableOptions(options);

  try {
    await client.send(
      new CreateTableCommand(buildCreateTableInput(options.tableName)),
    );
  } catch (error) {
    if (!isResourceInUseException(error)) {
      throw error;
    }
  }

  const waiterResult = await waitUntilTableExists(
    { client, maxWaitTime: 60 },
    { TableName: options.tableName },
  );

  if (waiterResult.state !== 'SUCCESS') {
    throw new Error(
      `Timed out waiting for table "${options.tableName}" to become ACTIVE.`,
    );
  }

  const described = await client.send(
    new DescribeTableCommand({ TableName: options.tableName }),
  );

  if (described.Table?.TableStatus !== 'ACTIVE') {
    throw new Error(
      `Table "${options.tableName}" is not ACTIVE (status=${described.Table?.TableStatus ?? 'unknown'}).`,
    );
  }
}

export function formatValidationTableSummary(
  options: CreateValidationTableOptions,
): string {
  const endpointLabel = options.endpoint ?? 'default AWS endpoint';
  return `Sprint 11 validation table "${options.tableName}" is ready (region=${options.region}, endpoint=${endpointLabel}).`;
}
