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

  // Do not log environment-derived table names or endpoints.
  console.log('AWS accounts validation table is ready.');
}

main().catch(() => {
  // Do not log the full AWS SDK error because it can contain configuration,
  // request metadata, endpoints, account details, or environment-derived data.
  console.error('Failed to prepare the AWS accounts validation table.');
  process.exitCode = 1;
});
