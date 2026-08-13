import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbEvidenceObservationRepository } from '../repositories/dynamodb/dynamodb-evidence-observation-repository';
import { MockEvidenceObservationRepository } from '../repositories/mock/mock-evidence-observation-repository';
import type { EvidenceObservationRepository } from '../repositories/contracts/evidence-observation-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('EvidenceObservationRepositoryFactory');

function shouldUseDurableEvidenceObservationRepository(): boolean {
  return Boolean(process.env.CLOUD_RESOURCES_TABLE_NAME?.trim());
}

export function createEvidenceObservationRepository(): EvidenceObservationRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableEvidenceObservationRepository()) {
    const tableName = process.env.CLOUD_RESOURCES_TABLE_NAME!.trim();
    return new DynamoDbEvidenceObservationRepository(dynamoDbDocumentClient, tableName);
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but CLOUD_RESOURCES_TABLE_NAME is not configured.',
    );
  }

  logger.warn('Falling back to in-memory evidence observation repository.', {
    operation: 'createEvidenceObservationRepository',
  });

  return new MockEvidenceObservationRepository();
}
