import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import {
  createAwsAccountsTable,
  parseCreateAwsAccountsTableEnv,
} from './lib/create-aws-accounts-table';

async function main(): Promise<void> {
  const options = parseCreateAwsAccountsTableEnv();

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

  await createAwsAccountsTable(client, options);
  console.log(`AWS accounts table ready: ${options.tableName}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
