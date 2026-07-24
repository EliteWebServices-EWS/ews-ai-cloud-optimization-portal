import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PersistenceConfigurationError,
  shouldUseDurablePersistence,
  validateDeployedPersistenceConfig,
} from '../../persistence/persistence-config';

function withEnv(
  vars: Record<string, string | undefined>,
  run: () => void
): void {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    snapshot[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const key of Object.keys(vars)) {
      const previous = snapshot[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

describe('validateDeployedPersistenceConfig', () => {
  it('allows local/test without tables', () => {
    withEnv(
      {
        ENVIRONMENT: 'test',
        PERSISTENCE_ENABLED: undefined,
        WORKFLOWS_TABLE_NAME: undefined,
      },
      () => {
        assert.doesNotThrow(() => validateDeployedPersistenceConfig());
        assert.equal(shouldUseDurablePersistence(), false);
      }
    );
  });

  it('requires all tables in production', () => {
    withEnv(
      {
        ENVIRONMENT: 'production',
        PERSISTENCE_ENABLED: 'true',
        WORKFLOWS_TABLE_NAME: 'wf',
        OWNERSHIP_TABLE_NAME: undefined,
        REPORTS_TABLE_NAME: undefined,
        LEARNING_TABLE_NAME: undefined,
        VERIFICATIONS_TABLE_NAME: undefined,
      },
      () => {
        assert.throws(
          () => validateDeployedPersistenceConfig(),
          PersistenceConfigurationError
        );
      }
    );
  });

  it('rejects persistence disabled in production', () => {
    withEnv(
      {
        ENVIRONMENT: 'production',
        PERSISTENCE_ENABLED: 'false',
        WORKFLOWS_TABLE_NAME: 'wf',
        OWNERSHIP_TABLE_NAME: 'own',
        REPORTS_TABLE_NAME: 'rep',
        LEARNING_TABLE_NAME: 'learn',
        VERIFICATIONS_TABLE_NAME: 'ver',
      },
      () => {
        assert.throws(
          () => validateDeployedPersistenceConfig(),
          PersistenceConfigurationError
        );
      }
    );
  });

  it('succeeds with full production config', () => {
    withEnv(
      {
        ENVIRONMENT: 'production',
        PERSISTENCE_ENABLED: 'true',
        WORKFLOWS_TABLE_NAME: 'wf',
        OWNERSHIP_TABLE_NAME: 'own',
        REPORTS_TABLE_NAME: 'rep',
        LEARNING_TABLE_NAME: 'learn',
        VERIFICATIONS_TABLE_NAME: 'ver',
      },
      () => {
        assert.doesNotThrow(() => validateDeployedPersistenceConfig());
        assert.equal(shouldUseDurablePersistence(), true);
      }
    );
  });
});
