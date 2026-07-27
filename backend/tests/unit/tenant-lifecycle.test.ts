import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidTenantTransitionError,
  validateTenantTransition,
} from '../../services/tenant-lifecycle';

test('allows PROVISIONING to ACTIVE', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('PROVISIONING', 'ACTIVE');
  });
});

test('allows PROVISIONING to DELETED', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('PROVISIONING', 'DELETED');
  });
});

test('allows ACTIVE to SUSPENDED', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('ACTIVE', 'SUSPENDED');
  });
});

test('allows ACTIVE to ARCHIVED', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('ACTIVE', 'ARCHIVED');
  });
});

test('allows SUSPENDED to ACTIVE', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('SUSPENDED', 'ACTIVE');
  });
});

test('allows SUSPENDED to ARCHIVED', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('SUSPENDED', 'ARCHIVED');
  });
});

test('allows ARCHIVED to DELETED', () => {
  assert.doesNotThrow(() => {
    validateTenantTransition('ARCHIVED', 'DELETED');
  });
});

test('rejects ACTIVE to PROVISIONING', () => {
  assert.throws(
    () => {
      validateTenantTransition('ACTIVE', 'PROVISIONING');
    },
    InvalidTenantTransitionError,
  );
});

test('rejects ARCHIVED to ACTIVE', () => {
  assert.throws(
    () => {
      validateTenantTransition('ARCHIVED', 'ACTIVE');
    },
    InvalidTenantTransitionError,
  );
});

test('rejects DELETED to ACTIVE', () => {
  assert.throws(
    () => {
      validateTenantTransition('DELETED', 'ACTIVE');
    },
    InvalidTenantTransitionError,
  );
});

test('rejects DELETED to SUSPENDED', () => {
  assert.throws(
    () => {
      validateTenantTransition('DELETED', 'SUSPENDED');
    },
    InvalidTenantTransitionError,
  );
});