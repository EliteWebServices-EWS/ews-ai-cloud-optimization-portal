import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import {
  DynamoDbExecutionHistoryRepository,
  DynamoDbExecutionPlanRepository,
} from '../repositories/dynamodb';
import {
  MockExecutionHistoryRepository,
  MockExecutionPlanRepository,
} from '../repositories/mock';
import type {
  ExecutionHistoryRepository,
  ExecutionPlanRepository,
} from '../repositories/contracts';
import { createLogger } from '../shared/utils';

const logger = createLogger('ExecutionRepositoryFactory');

function shouldUseDurableExecutionRepository(): boolean {
  return Boolean(process.env.EXECUTION_PLANS_TABLE_NAME?.trim());
}

export interface ExecutionRepositories {
  executionPlans: ExecutionPlanRepository;
  executionHistory: ExecutionHistoryRepository;
}

export function createExecutionRepositories(): ExecutionRepositories {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableExecutionRepository()) {
    const tableName = process.env.EXECUTION_PLANS_TABLE_NAME!.trim();

    return {
      executionPlans: new DynamoDbExecutionPlanRepository(
        dynamoDbDocumentClient,
        tableName,
      ),
      executionHistory: new DynamoDbExecutionHistoryRepository(
        dynamoDbDocumentClient,
        tableName,
      ),
    };
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but EXECUTION_PLANS_TABLE_NAME is not configured.',
    );
  }

  logger.warn(
    'Falling back to in-memory execution repositories — data will not survive a Lambda cold start. ' +
      'Configure EXECUTION_PLANS_TABLE_NAME for durable persistence.',
    { operation: 'createExecutionRepositories' },
  );

  return {
    executionPlans: new MockExecutionPlanRepository(),
    executionHistory: new MockExecutionHistoryRepository(),
  };
}

export function createExecutionPlanRepository(): ExecutionPlanRepository {
  return createExecutionRepositories().executionPlans;
}

export function createExecutionHistoryRepository(): ExecutionHistoryRepository {
  return createExecutionRepositories().executionHistory;
}
