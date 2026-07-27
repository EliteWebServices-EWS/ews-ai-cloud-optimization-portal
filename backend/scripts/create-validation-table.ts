import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import {
  createValidationTable,
  formatValidationTableSummary,
  parseCreateValidationTableEnv,
} from './lib/create-validation-table';

async function main(): Promise<void> {
  const options = parseCreateValidationTableEnv();
  const endpoint = options.endpoint ?? 'http://localhost:8000';

  const client = new DynamoDBClient({
    region: options.region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
    },
  });

  await createValidationTable(client, { ...options, endpoint });

  console.log(formatValidationTableSummary({ ...options, endpoint }));
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  const normalized = entry.replace(/\\/g, '/');
  return (
    normalized.endsWith('/scripts/create-validation-table.ts')
    || normalized.endsWith('create-validation-table.ts')
  );
}

if (isExecutedDirectly()) {
  main().catch((error: unknown) => {
    console.error(
      'Failed to create Sprint 11 validation table.',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
