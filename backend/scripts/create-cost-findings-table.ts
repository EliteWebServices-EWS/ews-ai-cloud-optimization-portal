import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import {
  createCostFindingsTable,
  parseCreateCostFindingsTableEnv,
} from './lib/create-cost-findings-table';

async function main(): Promise<void> {
  const options = parseCreateCostFindingsTableEnv();

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

  await createCostFindingsTable(client, options);

  // Do not log environment-derived table names or endpoints.
  console.log('Cost findings validation table is ready.');
}

main().catch(() => {
  // Do not log the full AWS SDK error because it can contain configuration,
  // request metadata, endpoints, account details, or environment-derived data.
  console.error('Failed to prepare the cost findings validation table.');
  process.exitCode = 1;
});
