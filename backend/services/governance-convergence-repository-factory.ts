import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbGovernanceConvergenceRepository } from '../repositories/dynamodb/dynamodb-governance-convergence-repository';
import { MockGovernanceConvergenceRepository } from '../repositories/mock/mock-governance-convergence-repository';
import type { GovernanceConvergenceRepository } from '../repositories/contracts/governance-convergence-repository';
import { createLogger } from '../shared/utils';

const logger = createLogger('GovernanceConvergenceRepositoryFactory');

/**
 * Reuses the same shared cloud-resources table as EC2 security/cost/
 * evidence-observation persistence (Task 4's "no new table or GSI"
 * precedent) — no additional DynamoDB table to provision or pay for.
 */
function shouldUseDurableGovernanceConvergenceRepository(): boolean {
  return Boolean(process.env.CLOUD_RESOURCES_TABLE_NAME?.trim());
}

export function createGovernanceConvergenceRepository(): GovernanceConvergenceRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableGovernanceConvergenceRepository()) {
    const tableName = process.env.CLOUD_RESOURCES_TABLE_NAME!.trim();
    return new DynamoDbGovernanceConvergenceRepository(dynamoDbDocumentClient, tableName);
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but CLOUD_RESOURCES_TABLE_NAME is not configured.',
    );
  }

  logger.warn('Falling back to in-memory governance convergence repository.', {
    operation: 'createGovernanceConvergenceRepository',
  });

  return new MockGovernanceConvergenceRepository();
}
