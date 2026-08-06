import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbEc2CostRepository } from '../repositories/dynamodb/dynamodb-ec2-cost-repository';
import { MockEc2CostRepository } from '../repositories/mock/mock-ec2-cost-repository';
import type {
  Ec2CostAnalysisRunRepository,
  Ec2CostRecommendationRepository,
} from '../repositories/contracts/ec2-cost-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('Ec2CostRepositoryFactory');

export interface Ec2CostRepositories {
  recommendations: Ec2CostRecommendationRepository;
  runs: Ec2CostAnalysisRunRepository;
}

function shouldUseDurableEc2CostRepository(): boolean {
  return Boolean(process.env.CLOUD_RESOURCES_TABLE_NAME?.trim());
}

export function createEc2CostRepositories(): Ec2CostRepositories {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableEc2CostRepository()) {
    const tableName = process.env.CLOUD_RESOURCES_TABLE_NAME!.trim();
    const repository = new DynamoDbEc2CostRepository(dynamoDbDocumentClient, tableName);
    return { recommendations: repository, runs: repository };
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but CLOUD_RESOURCES_TABLE_NAME is not configured.',
    );
  }

  logger.warn('Falling back to in-memory EC2 cost repository.', {
    operation: 'createEc2CostRepositories',
  });

  const mock = new MockEc2CostRepository();
  return { recommendations: mock, runs: mock };
}
