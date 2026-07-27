import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldUseDurableInvitationStore,
  shouldUseDurableMembershipStore,
} from '../../membership/membership.store';

function withEnv(
  vars: Record<string, string | undefined>,
  run: () => void,
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

describe('membership repository factory selection', () => {
  it('allows in-memory fallback in test without table env vars', () => {
    withEnv(
      {
        ENVIRONMENT: 'test',
        MEMBERSHIPS_TABLE_NAME: undefined,
        INVITATIONS_TABLE_NAME: undefined,
        PERSISTENCE_ENABLED: undefined,
      },
      () => {
        assert.equal(shouldUseDurableMembershipStore(), false);
        assert.equal(shouldUseDurableInvitationStore(), false);
      },
    );
  });

  it('selects DynamoDB when persistence is enabled and tables are configured', () => {
    withEnv(
      {
        ENVIRONMENT: 'production',
        PERSISTENCE_ENABLED: 'true',
        MEMBERSHIPS_TABLE_NAME: 'sisum-memberships-test',
        INVITATIONS_TABLE_NAME: 'sisum-invitations-test',
      },
      () => {
        assert.equal(shouldUseDurableMembershipStore(), true);
        assert.equal(shouldUseDurableInvitationStore(), true);
      },
    );
  });

  it('falls back when persistence is disabled', () => {
    withEnv(
      {
        MEMBERSHIPS_TABLE_NAME: 'sisum-memberships-test',
        INVITATIONS_TABLE_NAME: 'sisum-invitations-test',
        PERSISTENCE_ENABLED: 'false',
      },
      () => {
        assert.equal(shouldUseDurableMembershipStore(), false);
        assert.equal(shouldUseDurableInvitationStore(), false);
      },
    );
  });

  it('falls back when membership table is missing', () => {
    withEnv(
      {
        PERSISTENCE_ENABLED: 'true',
        MEMBERSHIPS_TABLE_NAME: undefined,
        INVITATIONS_TABLE_NAME: 'sisum-invitations-test',
      },
      () => {
        assert.equal(shouldUseDurableMembershipStore(), false);
        assert.equal(shouldUseDurableInvitationStore(), true);
      },
    );
  });

  it('falls back when invitation table is missing', () => {
    withEnv(
      {
        PERSISTENCE_ENABLED: 'true',
        MEMBERSHIPS_TABLE_NAME: 'sisum-memberships-test',
        INVITATIONS_TABLE_NAME: undefined,
      },
      () => {
        assert.equal(shouldUseDurableMembershipStore(), true);
        assert.equal(shouldUseDurableInvitationStore(), false);
      },
    );
  });
});
