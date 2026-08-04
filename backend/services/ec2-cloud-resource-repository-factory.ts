import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbEc2CloudResourceRepository } from '../repositories/dynamodb/dynamodb-ec2-cloud-resource-repository';
import { MockEc2CloudResourceRepository } from '../repositories/mock/mock-ec2-cloud-resource-repository';
import type {
  Ec2CloudResourceRepository,
  Ec2DiscoveryRunRepository,
} from '../repositories/contracts/ec2-cloud-resource-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('Ec2CloudResourceRepositoryFactory');

export interface Ec2CloudResourceRepositories {
  resources: Ec2CloudResourceRepository;
  runs: Ec2DiscoveryRunRepository;
}

function shouldUseDurableEc2Repository(): boolean {
  return Boolean(process.env.CLOUD_RESOURCES_TABLE_NAME?.trim());
}

export function createEc2CloudResourceRepositories(): Ec2CloudResourceRepositories {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableEc2Repository()) {
    const tableName = process.env.CLOUD_RESOURCES_TABLE_NAME!.trim();
    const repository = new DynamoDbEc2CloudResourceRepository(
      dynamoDbDocumentClient,
      tableName,
    );
    return { resources: repository, runs: repository };
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but CLOUD_RESOURCES_TABLE_NAME is not configured.',
    );
  }

  logger.warn(
    'Falling back to in-memory EC2 cloud resource repository.',
    { operation: 'createEc2CloudResourceRepositories' },
  );

  const mock = new MockEc2CloudResourceRepository();
  return { resources: mock, runs: mock };
}
