import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PersistenceConfigurationError,
} from '../../persistence/persistence-config';

import {
  createExecutionRepositories,
} from '../../services/execution-repository-factory';

import { MockExecutionPlanRepository } from '../../repositories/mock/mock-execution-plan-repository';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test('fails closed in deployed environments without table configuration', () => {
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

  assert.throws(
    () => createExecutionRepositories(),
    PersistenceConfigurationError,
  );
});

test('uses in-memory repositories when persistence is disabled locally', () => {
  process.env.ENVIRONMENT = 'development';
  process.env.PERSISTENCE_ENABLED = 'false';
  delete process.env.EXECUTION_PLANS_TABLE_NAME;

  const repositories = createExecutionRepositories();
  assert.ok(repositories.executionPlans instanceof MockExecutionPlanRepository);
});
