import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseDurableWorkflowStore } from '../../orchestrator/workflow.store';

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

describe('createWorkflowStore factory selection', () => {
  it('shouldUseDurableWorkflowStore is false without table env vars', () => {
    withEnv(
      {
        WORKFLOWS_TABLE_NAME: undefined,
        OWNERSHIP_TABLE_NAME: undefined,
        PERSISTENCE_ENABLED: undefined,
      },
      () => {
        assert.equal(shouldUseDurableWorkflowStore(), false);
      }
    );
  });

  it('selects durable storage when tables are configured and persistence is enabled', () => {
    withEnv(
      {
        WORKFLOWS_TABLE_NAME: 'sisum-workflows-test',
        OWNERSHIP_TABLE_NAME: 'sisum-ownership-test',
        PERSISTENCE_ENABLED: 'true',
      },
      () => {
        assert.equal(shouldUseDurableWorkflowStore(), true);
      }
    );
  });

  it('falls back to in-memory when persistence is disabled', () => {
    withEnv(
      {
        WORKFLOWS_TABLE_NAME: 'sisum-workflows-test',
        OWNERSHIP_TABLE_NAME: 'sisum-ownership-test',
        PERSISTENCE_ENABLED: 'false',
      },
      () => {
        assert.equal(shouldUseDurableWorkflowStore(), false);
      }
    );
  });

  it('falls back to in-memory when ownership table is missing', () => {
    withEnv(
      {
        WORKFLOWS_TABLE_NAME: 'sisum-workflows-test',
        OWNERSHIP_TABLE_NAME: undefined,
        PERSISTENCE_ENABLED: 'true',
      },
      () => {
        assert.equal(shouldUseDurableWorkflowStore(), false);
      }
    );
  });
});
