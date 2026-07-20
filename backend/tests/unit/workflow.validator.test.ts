/**
 * Workflow validator unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_EXECUTION_STATES,
  WORKFLOW_STAGES,
  WORKFLOW_STATES,
  PLUGIN_NAMES,
  PROVIDER_NAMES,
  PLATFORM_MODE,
} from '../../shared/constants';
import type { WorkflowContext } from '../../orchestrator/workflow.types';
import { createRetryState } from '../../orchestrator/workflow.retry';
import {
  validateFinancialStage,
  validateGovernanceStage,
} from '../../orchestrator/workflow.validator';
import { WorkflowValidationError } from '../../orchestrator/workflow.errors';

function baseContext(): WorkflowContext {
  return {
    workflowId: 'wf-test',
    tenantId: 'sisum-default',
    plugin: PLUGIN_NAMES.EC2,
    provider: PROVIDER_NAMES.MOCK,
    region: 'us-east-1',
    mode: PLATFORM_MODE.DEMO,
    triggerSource: 'api',
    startedAt: new Date().toISOString(),
    status: WORKFLOW_STATES.RUNNING,
    executionState: WORKFLOW_EXECUTION_STATES.INITIALIZED,
    completedStages: [],
    failedStages: [],
    retry: createRetryState(),
  };
}

describe('WorkflowValidator', () => {
  it('rejects governance stage without evidence', () => {
    const context = baseContext();
    assert.throws(
      () => validateGovernanceStage(context),
      (error: WorkflowValidationError) => {
        assert.equal(error.code, 'WORKFLOW_VALIDATION_ERROR');
        return true;
      }
    );
  });

  it('rejects financial stage without governance result', () => {
    const context = baseContext();
    context.completedStages = [WORKFLOW_STAGES.EVIDENCE, WORKFLOW_STAGES.GOVERNANCE];

    assert.throws(
      () => validateFinancialStage(context),
      (error: WorkflowValidationError) => {
        assert.match(error.message, /Governance result is required/);
        return true;
      }
    );
  });

  it('rejects financial stage when prior stage failed', () => {
    const context = baseContext();
    context.completedStages = [WORKFLOW_STAGES.EVIDENCE];
    context.failedStages = [WORKFLOW_STAGES.GOVERNANCE];

    assert.throws(
      () => validateFinancialStage(context),
      (error: WorkflowValidationError) => {
        assert.match(error.message, /failed stages/);
        return true;
      }
    );
  });
});
