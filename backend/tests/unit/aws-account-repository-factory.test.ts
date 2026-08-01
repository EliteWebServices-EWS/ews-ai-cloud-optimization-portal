import assert from 'node:assert/strict';
import test from 'node:test';

import { PersistenceConfigurationError } from '../../persistence/persistence-config';
import { createAwsAccountRepository } from '../../services/aws-account-repository-factory';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { DynamoDbAwsAccountRepository } from '../../repositories/dynamodb/dynamodb-aws-account-repository';

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

function setFullProductionTables(): void {
  process.env.WORKFLOWS_TABLE_NAME = 'wf';
  process.env.OWNERSHIP_TABLE_NAME = 'own';
  process.env.REPORTS_TABLE_NAME = 'rep';
  process.env.LEARNING_TABLE_NAME = 'learn';
  process.env.VERIFICATIONS_TABLE_NAME = 'ver';
  process.env.TENANTS_TABLE_NAME = 'tenants';
  process.env.MEMBERSHIPS_TABLE_NAME = 'mem';
  process.env.INVITATIONS_TABLE_NAME = 'inv';
  process.env.EXECUTION_PLANS_TABLE_NAME = 'exec';
  process.env.AWS_ACCOUNTS_TABLE_NAME = 'aws-accounts';
}

test('uses mock repository locally when persistence is disabled', () => {
  process.env.ENVIRONMENT = 'development';
  process.env.PERSISTENCE_ENABLED = 'false';
  delete process.env.AWS_ACCOUNTS_TABLE_NAME;

  const repository = createAwsAccountRepository();
  assert.ok(repository instanceof MockAwsAccountRepository);
});

test('uses DynamoDB repository when table is configured', () => {
  process.env.ENVIRONMENT = 'development';
  process.env.PERSISTENCE_ENABLED = 'true';
  setFullProductionTables();

  const repository = createAwsAccountRepository();
  assert.ok(repository instanceof DynamoDbAwsAccountRepository);
});

test('fails closed in deployed environments without AWS accounts table', () => {
  process.env.ENVIRONMENT = 'production';
  process.env.PERSISTENCE_ENABLED = 'true';
  setFullProductionTables();
  delete process.env.AWS_ACCOUNTS_TABLE_NAME;

  assert.throws(
    () => createAwsAccountRepository(),
    PersistenceConfigurationError,
  );
});
