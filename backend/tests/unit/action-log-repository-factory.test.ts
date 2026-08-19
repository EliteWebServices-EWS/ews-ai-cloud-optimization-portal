import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PersistenceConfigurationError,
} from '../../persistence/persistence-config';
import {
  createActionLogRepository,
  createActionLogService,
} from '../../services/action-log-repository-factory';
import { DynamoDbActionLogRepository } from '../../repositories/dynamodb/dynamodb-action-log-repository';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test('fails closed in deployed environments without execution plans table', () => {
  process.env.ENVIRONMENT = 'production';
  process.env.PERSISTENCE_ENABLED = 'true';
  process.env.WORKFLOWS_TABLE_NAME = 'wf';
  process.env.OWNERSHIP_TABLE_NAME = 'own';
  process.env.REPORTS_TABLE_NAME = 'rep';
  process.env.LEARNING_TABLE_NAME = 'learn';
  process.env.VERIFICATIONS_TABLE_NAME = 'ver';
  process.env.TENANTS_TABLE_NAME = 'tenants';
  process.env.MEMBERSHIPS_TABLE_NAME = 'mem';
  process.env.INVITATIONS_TABLE_NAME = 'inv';
  delete process.env.EXECUTION_PLANS_TABLE_NAME;

  assert.throws(() => createActionLogRepository(), PersistenceConfigurationError);
});

test('uses mock ActionLog repository when persistence is disabled locally', () => {
  process.env.ENVIRONMENT = 'development';
  process.env.PERSISTENCE_ENABLED = 'false';
  delete process.env.EXECUTION_PLANS_TABLE_NAME;

  const repository = createActionLogRepository();
  assert.ok(repository instanceof MockActionLogRepository);
});

test('uses DynamoDB ActionLog repository when execution plans table is configured', () => {
  process.env.ENVIRONMENT = 'production';
  process.env.PERSISTENCE_ENABLED = 'true';
  process.env.WORKFLOWS_TABLE_NAME = 'wf';
  process.env.OWNERSHIP_TABLE_NAME = 'own';
  process.env.REPORTS_TABLE_NAME = 'rep';
  process.env.LEARNING_TABLE_NAME = 'learn';
  process.env.VERIFICATIONS_TABLE_NAME = 'ver';
  process.env.TENANTS_TABLE_NAME = 'tenants';
  process.env.MEMBERSHIPS_TABLE_NAME = 'mem';
  process.env.INVITATIONS_TABLE_NAME = 'inv';
  process.env.AWS_ACCOUNTS_TABLE_NAME = 'accounts';
  process.env.CLOUD_RESOURCES_TABLE_NAME = 'cloud';
  process.env.EXECUTION_PLANS_TABLE_NAME = 'sisum-execution-plans-test';

  const repository = createActionLogRepository();
  assert.ok(repository instanceof DynamoDbActionLogRepository);
});

test('createActionLogService wraps repository factory output', () => {
  process.env.ENVIRONMENT = 'development';
  process.env.PERSISTENCE_ENABLED = 'false';
  delete process.env.EXECUTION_PLANS_TABLE_NAME;

  const service = createActionLogService();
  assert.ok(service instanceof ActionLogService);
});
