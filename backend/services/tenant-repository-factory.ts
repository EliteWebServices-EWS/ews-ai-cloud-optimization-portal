/**
 * Tenant registry persistence — administration API.
 *
 * Chooses durable DynamoDB persistence whenever TENANTS_TABLE_NAME is
 * configured and persistence is not explicitly disabled
 * (PERSISTENCE_ENABLED=false) — which is always true in deployed
 * environments (see backend/template.yaml), mirroring
 * orchestrator/workflow.store.ts's createWorkflowStore(). Falls back to an
 * in-memory repository only for local development without that table
 * configured.
 */

import { dynamoDbDocumentClient } from '../database';
import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../persistence/persistence-config';
import { DynamoDbTenantRepository } from '../repositories/dynamodb';
import { MockTenantRepository } from '../repositories/mock';
import type { TenantRepository } from '../repositories/contracts';
import { createLogger } from '../shared/utils';

const logger = createLogger('TenantRepositoryFactory');

function shouldUseDurableTenantRepository(): boolean {
  return Boolean(process.env.TENANTS_TABLE_NAME?.trim());
}

export function createTenantRepository(): TenantRepository {
  validateDeployedPersistenceConfig();

  if (shouldUseDurablePersistence() && shouldUseDurableTenantRepository()) {
    const tenantsTableName = process.env.TENANTS_TABLE_NAME!.trim();

    return new DynamoDbTenantRepository(
      dynamoDbDocumentClient,
      tenantsTableName
    );
  }

  if (shouldUseDurablePersistence()) {
    throw new PersistenceConfigurationError(
      'Deployed persistence is enabled but TENANTS_TABLE_NAME is not configured.'
    );
  }

  logger.warn(
    'Falling back to in-memory tenant repository — data will not survive a Lambda cold start. ' +
      'Configure TENANTS_TABLE_NAME for durable persistence.',
    { operation: 'createTenantRepository' }
  );

  return new MockTenantRepository();
}
