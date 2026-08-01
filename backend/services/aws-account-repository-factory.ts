import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbAwsAccountRepository } from '../repositories/dynamodb/dynamodb-aws-account-repository';
import { MockAwsAccountRepository } from '../repositories/mock/mock-aws-account-repository';
import type { AwsAccountRepository } from '../repositories/contracts';
import { createLogger } from '../shared/utils';

const logger = createLogger('AwsAccountRepositoryFactory');

function shouldUseDurableAwsAccountRepository(): boolean {
  return Boolean(process.env.AWS_ACCOUNTS_TABLE_NAME?.trim());
}

export function createAwsAccountRepository(): AwsAccountRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableAwsAccountRepository()) {
    const tableName = process.env.AWS_ACCOUNTS_TABLE_NAME!.trim();

    return new DynamoDbAwsAccountRepository(
      dynamoDbDocumentClient,
      tableName,
    );
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but AWS_ACCOUNTS_TABLE_NAME is not configured.',
    );
  }

  logger.warn(
    'Falling back to in-memory AWS account repository — data will not survive a Lambda cold start. ' +
      'Configure AWS_ACCOUNTS_TABLE_NAME for durable persistence.',
    { operation: 'createAwsAccountRepository' },
  );

  return new MockAwsAccountRepository();
}
