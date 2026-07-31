import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canPerformExecutionPrivilegedAction } from '../../auth/execution-api-authorization';
import { TENANT_ROLES } from '../../auth/tenant-roles';

describe('Execution API authorization helpers', () => {
  it('allows platform administrators', () => {
    assert.equal(
      canPerformExecutionPrivilegedAction(undefined, [], true),
      true,
    );
  });

  it('allows tenant owner and security admin memberships', () => {
    assert.equal(
      canPerformExecutionPrivilegedAction(
        TENANT_ROLES.TENANT_OWNER,
        ['admin'],
        false,
      ),
      true,
    );
    assert.equal(
      canPerformExecutionPrivilegedAction(
        TENANT_ROLES.SECURITY_ADMIN,
        ['admin'],
        false,
      ),
      true,
    );
  });

  it('denies tenant analyst membership', () => {
    assert.equal(
      canPerformExecutionPrivilegedAction(
        TENANT_ROLES.ANALYST,
        ['analyst'],
        false,
      ),
      false,
    );
  });
});
