import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateProductionExecutionEligibility,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../execution';
import { EXECUTION_MODES } from '../../execution/adapters/types';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import { POST_ACTION_VERIFICATION_REASON } from '../../post-action-verification/reason-codes';
import { MockExecutionRunRepository } from '../../repositories/mock/mock-execution-run-repository';
import { EXECUTION_STATUS, VERIFICATION_STATUS } from '../../shared/constants';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import { buildMlFailedSafeModelUnavailableDecision } from '../fixtures/evidence/ml-fixtures';
import { buildExecutionApiSuccessRecommendationResolvedInput } from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Sprint 3 execution provider failure verification lifecycle', () => {
  it('approved eligible candidate → provider execute fails → verification is not RESOLVED or HEALTHY', async () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(buildMlFailedSafeModelUnavailableDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    const eligible = evaluateProductionExecutionEligibility({
      policy,
      approvalRequired: true,
      approvalStatus: 'APPROVED',
      planStatus: 'APPROVED',
    });
    assert.equal(eligible.executionEligibility, 'ELIGIBLE');

    const runs = new MockExecutionRunRepository();
    const orchestrator = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(() => ({}), {
        ec2: {
          service: 'ec2',
          supportedActions: () => ['START_INSTANCE'],
          validate: async () => ({ valid: true, checks: [] }),
          buildDryRunPlan: () => ({
            service: 'ec2',
            action: 'START_INSTANCE',
            resourceId: 'i-provider-fail',
            region: 'us-east-1',
            steps: [],
            reversible: true,
          }),
          capturePreviousConfiguration: async () => ({ state: 'stopped' }),
          execute: async () => ({
            success: false,
            message: 'provider unavailable',
            error: {
              code: 'EXECUTION_FAILED',
              message: 'provider unavailable',
              stage: 'execute',
            },
          }),
          verify: async () => ({ verified: true, checks: [] }),
          rollback: async () => ({ success: true, message: 'not invoked' }),
          isRollbackEligible: () => ({ eligible: false, reason: 'rollback disabled for provider failure test' }),
        },
      }),
      runs,
    });

    const runResult = await orchestrator.run(
      {
        tenantId: TENANT_A,
        actorId: 'approver-1',
        actor: {
          authenticated: true,
          userId: 'approver-1',
          email: 'approver-1@example.com',
          roles: ['admin'],
        },
        correlationId: 'corr-exec-provider-fail',
        requestId: 'req-exec-provider-fail',
        region: 'us-east-1',
        mode: EXECUTION_MODES.PRODUCTION,
      },
      {
        service: 'ec2',
        action: 'START_INSTANCE',
        resourceId: 'i-provider-fail',
      },
    );

    assert.equal(runResult.status, 'FAILED');
    assert.equal(runResult.failure?.code, 'EXECUTION_FAILED');

    const persistedRun = await runs.getById(TENANT_A, runResult.runId);
    assert.equal(persistedRun?.status, 'FAILED');
    assert.equal(persistedRun?.failure?.code, 'EXECUTION_FAILED');

    const fixture = buildExecutionApiSuccessRecommendationResolvedInput();
    const verificationService = new PostActionVerificationService();
    const assessment = verificationService.evaluate({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-exec-provider-fail',
      executionId: runResult.runId,
      expectation: fixture.expectation,
      observation: null,
      executionCompleted: false,
      executionResult: {
        ...fixture.executionResult,
        executionId: runResult.runId,
        resourceId: 'i-provider-fail',
        status: EXECUTION_STATUS.FAILED,
        success: false,
        message: runResult.failure?.message ?? 'provider unavailable',
      },
    });

    assert.equal(assessment.outcome, 'INSUFFICIENT_EVIDENCE');
    assert.notEqual(assessment.outcome, 'RESOLVED');
    assert.notEqual(assessment.outcome, 'HEALTHY');
    assert.equal(assessment.comparatorResult.status, VERIFICATION_STATUS.PENDING);
    assert.ok(
      assessment.reasonCodes.includes(POST_ACTION_VERIFICATION_REASON.EXECUTION_NOT_COMPLETED),
    );
    assert.ok(
      assessment.reasonCodes.includes(POST_ACTION_VERIFICATION_REASON.INSUFFICIENT_EVIDENCE),
    );
  });
});
