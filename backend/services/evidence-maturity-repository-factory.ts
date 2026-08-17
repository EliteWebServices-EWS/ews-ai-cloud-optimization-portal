import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbEvidenceMaturityRepository } from '../repositories/dynamodb/dynamodb-evidence-maturity-repository';
import { MockEvidenceMaturityRepository } from '../repositories/mock/mock-evidence-maturity-repository';
import type { EvidenceMaturityRepository } from '../repositories/contracts/evidence-maturity-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('EvidenceMaturityRepositoryFactory');

function shouldUseDurableEvidenceMaturityRepository(): boolean {
  return Boolean(process.env.CLOUD_RESOURCES_TABLE_NAME?.trim());
}

export function createEvidenceMaturityRepository(): EvidenceMaturityRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableEvidenceMaturityRepository()) {
    const tableName = process.env.CLOUD_RESOURCES_TABLE_NAME!.trim();
    return new DynamoDbEvidenceMaturityRepository(dynamoDbDocumentClient, tableName);
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but CLOUD_RESOURCES_TABLE_NAME is not configured.',
    );
  }

  logger.warn('Falling back to in-memory evidence maturity repository.', {
    operation: 'createEvidenceMaturityRepository',
  });

  return new MockEvidenceMaturityRepository();
}
