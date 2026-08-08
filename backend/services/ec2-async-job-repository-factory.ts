import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbEc2AsyncJobRepository } from '../repositories/dynamodb/dynamodb-ec2-async-job-repository';
import { MockEc2AsyncJobRepository } from '../repositories/mock/mock-ec2-async-job-repository';
import type { Ec2AsyncJobRepository } from '../repositories/contracts/ec2-async-job-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('Ec2AsyncJobRepositoryFactory');

export function createEc2AsyncJobRepository(): Ec2AsyncJobRepository {
  validateDeployedPersistenceConfig();
  const tableName = process.env.ASYNC_JOBS_TABLE_NAME?.trim();

  if (shouldUseDurablePersistence() && tableName) {
    return new DynamoDbEc2AsyncJobRepository(dynamoDbDocumentClient, tableName);
  }

  if (shouldUseDurablePersistence() && !tableName) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but ASYNC_JOBS_TABLE_NAME is not configured.',
    );
  }

  logger.warn('Using in-memory EC2 async job repository.', {
    operation: 'createEc2AsyncJobRepository',
  });
  return new MockEc2AsyncJobRepository();
}
