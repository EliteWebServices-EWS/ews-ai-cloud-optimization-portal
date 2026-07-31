import '../test-env-bootstrap';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDeployedEnvironment } from '../../persistence/persistence-config';

test('test runner uses non-deployed ENVIRONMENT and NODE_ENV', () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.ENVIRONMENT, 'test');
  assert.equal(process.env.PERSISTENCE_ENABLED, 'false');
  assert.equal(isDeployedEnvironment(), false);
});
