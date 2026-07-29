import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import {
  createExecutionPlansTable,
  parseCreateExecutionPlansTableEnv,
} from './lib/create-execution-plans-table';

async function main(): Promise<void> {
  const options = parseCreateExecutionPlansTableEnv();

  const client = new DynamoDBClient({
    region: options.region,
    endpoint: options.endpoint,
    credentials: options.endpoint
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
        }
      : undefined,
  });

  await createExecutionPlansTable(client, options);
  console.log(`Execution plans table ready: ${options.tableName}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
