import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ExecutionPlanValidationError,
  validateExecutionPlanShape,
  validateAppendExecutionHistoryInput,
} from '../../repositories/models/execution-persistence-models';

function validPlanInput() {
  return {
    executionId: 'exec-1',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    recommendationId: 'rec-1',
    planStatus: 'DRAFT' as const,
    createdBy: 'user-1',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'RESIZE',
        resourceType: 'EC2',
        resourceId: 'i-123',
        description: 'Resize instance',
      },
    ],
    rollbackPlan: {
      strategy: 'REVERSE',
      steps: [],
      automatic: false,
    },
    riskLevel: 'LOW' as const,
    approvalRequired: false,
    approvalStatus: 'NOT_REQUIRED' as const,
    metadata: { source: 'test' },
  };
}

describe('validateExecutionPlanShape', () => {
  it('accepts a valid plan', () => {
    assert.doesNotThrow(() => validateExecutionPlanShape(validPlanInput()));
  });

  it('rejects missing executionId', () => {
    assert.throws(
      () =>
        validateExecutionPlanShape({
          ...validPlanInput(),
          executionId: ' ',
        }),
      ExecutionPlanValidationError,
    );
  });

  it('rejects missing tenantId', () => {
    assert.throws(
      () =>
        validateExecutionPlanShape({
          ...validPlanInput(),
          tenantId: '',
        }),
      ExecutionPlanValidationError,
    );
  });

  it('rejects empty execution steps', () => {
    assert.throws(
      () =>
        validateExecutionPlanShape({
          ...validPlanInput(),
          executionSteps: [],
        }),
      ExecutionPlanValidationError,
    );
  });

  it('rejects duplicate step IDs', () => {
    assert.throws(
      () =>
        validateExecutionPlanShape({
          ...validPlanInput(),
          executionSteps: [
            validPlanInput().executionSteps[0]!,
            { ...validPlanInput().executionSteps[0]!, order: 1 },
          ],
        }),
      ExecutionPlanValidationError,
    );
  });

  it('rejects invalid approval combination', () => {
    assert.throws(
      () =>
        validateExecutionPlanShape({
          ...validPlanInput(),
          approvalRequired: false,
          approvalStatus: 'PENDING',
        }),
      ExecutionPlanValidationError,
    );
  });

  it('rejects unsupported risk level', () => {
    assert.throws(
      () =>
        validateExecutionPlanShape({
          ...validPlanInput(),
          riskLevel: 'EXTREME' as 'LOW',
        }),
      ExecutionPlanValidationError,
    );
  });
});

describe('validateAppendExecutionHistoryInput', () => {
  it('requires core identity fields', () => {
    assert.throws(
      () =>
        validateAppendExecutionHistoryInput({
          historyId: '',
          tenantId: 'tenant-1',
          executionId: 'exec-1',
          workflowId: 'wf-1',
          eventType: 'PLAN_CREATED',
          actorId: 'user-1',
          createdAt: new Date().toISOString(),
        }),
      ExecutionPlanValidationError,
    );
  });
});
