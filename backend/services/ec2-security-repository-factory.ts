import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbEc2SecurityRepository } from '../repositories/dynamodb/dynamodb-ec2-security-repository';
import { MockEc2SecurityRepository } from '../repositories/mock/mock-ec2-security-repository';
import type {
  Ec2SecurityAnalysisRunRepository,
  Ec2SecurityFindingRepository,
  Ec2SecuritySummaryRepository,
} from '../repositories/contracts/ec2-security-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('Ec2SecurityRepositoryFactory');

export interface Ec2SecurityRepositories {
  findings: Ec2SecurityFindingRepository;
  summaries: Ec2SecuritySummaryRepository;
  runs: Ec2SecurityAnalysisRunRepository;
}

function shouldUseDurableEc2SecurityRepository(): boolean {
  return Boolean(process.env.CLOUD_RESOURCES_TABLE_NAME?.trim());
}

export function createEc2SecurityRepositories(): Ec2SecurityRepositories {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableEc2SecurityRepository()) {
    const tableName = process.env.CLOUD_RESOURCES_TABLE_NAME!.trim();
    const repository = new DynamoDbEc2SecurityRepository(dynamoDbDocumentClient, tableName);
    return { findings: repository, summaries: repository, runs: repository };
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but CLOUD_RESOURCES_TABLE_NAME is not configured.',
    );
  }

  logger.warn('Falling back to in-memory EC2 security repository.', {
    operation: 'createEc2SecurityRepositories',
  });

  const mock = new MockEc2SecurityRepository();
  return { findings: mock, summaries: mock, runs: mock };
}
