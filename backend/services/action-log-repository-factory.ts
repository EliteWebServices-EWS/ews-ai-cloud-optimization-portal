import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbActionLogRepository } from '../repositories/dynamodb/dynamodb-action-log-repository';
import { MockActionLogRepository } from '../repositories/mock/mock-action-log-repository';
import type { ActionLogRepository } from '../repositories/contracts/action-log-repository';
import { ActionLogService } from './action-log-service';
import { createLogger } from '../shared/utils';

const logger = createLogger('ActionLogRepositoryFactory');

function shouldUseDurableActionLogRepository(): boolean {
  return Boolean(process.env.EXECUTION_PLANS_TABLE_NAME?.trim());
}

export function createActionLogRepository(): ActionLogRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableActionLogRepository()) {
    const tableName = process.env.EXECUTION_PLANS_TABLE_NAME!.trim();
    return new DynamoDbActionLogRepository(dynamoDbDocumentClient, tableName);
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but EXECUTION_PLANS_TABLE_NAME is not configured.',
    );
  }

  logger.warn(
    'Falling back to in-memory ActionLog repository — data will not survive a Lambda cold start. ' +
      'Configure EXECUTION_PLANS_TABLE_NAME for durable persistence.',
    { operation: 'createActionLogRepository' },
  );

  return new MockActionLogRepository();
}

export function createActionLogService(): ActionLogService {
  return new ActionLogService(createActionLogRepository());
}
