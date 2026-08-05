import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbCostFindingRepository } from '../repositories/dynamodb/dynamodb-cost-finding-repository';
import { MockCostFindingRepository } from '../repositories/mock/mock-cost-finding-repository';
import type { CostFindingRepository } from '../repositories/contracts';
import { createLogger } from '../shared/utils';

const logger = createLogger('CostIntelligenceRepositoryFactory');

function shouldUseDurableCostFindingRepository(): boolean {
  return Boolean(process.env.COST_FINDINGS_TABLE_NAME?.trim());
}

export function createCostFindingRepository(): CostFindingRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableCostFindingRepository()) {
    const tableName = process.env.COST_FINDINGS_TABLE_NAME!.trim();

    return new DynamoDbCostFindingRepository(dynamoDbDocumentClient, tableName);
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but COST_FINDINGS_TABLE_NAME is not configured.',
    );
  }

  logger.warn(
    'Falling back to in-memory cost finding repository — data will not survive a Lambda cold start. ' +
      'Configure COST_FINDINGS_TABLE_NAME for durable persistence.',
    { operation: 'createCostFindingRepository' },
  );

  return new MockCostFindingRepository();
}
