import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWorkflowDemoReportsAllowed,
  isWorkflowDemoReportsEnabled,
} from '../../shared/platform-features';
import { AppError } from '../../shared/utils/errors';
import { PROVIDER_NAMES } from '../../shared/constants';

describe('platform-features workflow demo reports', () => {
  let previousProvider: string | undefined;
  let previousDemo: string | undefined;

  beforeEach(() => {
    previousProvider = process.env.PROVIDER_MODE;
    previousDemo = process.env.WORKFLOW_DEMO_REPORTS_ENABLED;
  });

  afterEach(() => {
    if (previousProvider === undefined) {
      delete process.env.PROVIDER_MODE;
    } else {
      process.env.PROVIDER_MODE = previousProvider;
    }
    if (previousDemo === undefined) {
      delete process.env.WORKFLOW_DEMO_REPORTS_ENABLED;
    } else {
      process.env.WORKFLOW_DEMO_REPORTS_ENABLED = previousDemo;
    }
  });

  it('defaults demo reports to disabled', () => {
    delete process.env.WORKFLOW_DEMO_REPORTS_ENABLED;
    assert.equal(isWorkflowDemoReportsEnabled(), false);
  });

  it('blocks mock workflow demo generation when flag is false', () => {
    process.env.PROVIDER_MODE = PROVIDER_NAMES.MOCK;
    process.env.WORKFLOW_DEMO_REPORTS_ENABLED = 'false';

    assert.throws(() => assertWorkflowDemoReportsAllowed(), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'DEMO_REPORTS_DISABLED');
      assert.equal(error.statusCode, 403);
      return true;
    });
  });

  it('allows mock workflow demo generation when flag is true', () => {
    process.env.PROVIDER_MODE = PROVIDER_NAMES.MOCK;
    process.env.WORKFLOW_DEMO_REPORTS_ENABLED = 'true';
    assert.doesNotThrow(() => assertWorkflowDemoReportsAllowed());
  });

  it('does not gate when provider mode is aws', () => {
    process.env.PROVIDER_MODE = PROVIDER_NAMES.AWS;
    delete process.env.WORKFLOW_DEMO_REPORTS_ENABLED;
    assert.doesNotThrow(() => assertWorkflowDemoReportsAllowed());
  });
});
