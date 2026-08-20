import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateProductionExecutionEligibility,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import {
  buildSprint3LifecycleResult,
  PostActionVerificationService,
} from '../../post-action-verification';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { FIXED_POLICY_EVALUATED_AT } from '../fixtures/action-policy/policy-fixtures';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import {
  buildMlDecisionEvaluateInput,
  buildReadySprint2DecisionReadiness,
} from '../fixtures/evidence/ml-fixtures';
import {
  buildExecutionApiSuccessRecommendationResolvedInput,
  SPRINT3_FINDING_KEY,
  SPRINT3_WORKFLOW_ID,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Sprint 3 cross-module golden path', () => {
  it('runs observation→readiness→ML→policy→approval→simulation→verification→ActionLog with real service boundaries', async () => {
    const readiness = buildReadySprint2DecisionReadiness();
    assert.equal(readiness.readiness, 'READY');
    assert.equal(readiness.maturity?.maturity, 'MATURE');
    assert.equal(readiness.governance.convergence.state, 'PRESERVED');
    assert.equal(readiness.confidence.status, 'HIGH');

    const mlInput = buildMlDecisionEvaluateInput({ decisionReadiness: readiness });
    const mlService = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.92 }));
    const { decision } = await mlService.evaluate(mlInput);
    const summary = toMlDecisionSummary(decision);

    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: {
        readiness: readiness.readiness,
        reasonCodes: readiness.reasonCodes,
        policyVersion: readiness.policyVersion,
        recommendedAction: readiness.recommendedAction,
      },
      mlDecisionSummary: summary,
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

    const verificationFixture = buildExecutionApiSuccessRecommendationResolvedInput();
    const verificationService = new PostActionVerificationService(
      undefined,
      new MockVerificationRepository(),
    );
    const { assessment, persisted } = await verificationService.evaluateAndPersist({
      ...verificationFixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: SPRINT3_WORKFLOW_ID,
      executionId: verificationFixture.executionResult.executionId,
      expectation: verificationFixture.expectation,
      observation: verificationFixture.observation,
      executionResult: verificationFixture.executionResult,
    });

    assert.equal(assessment.outcome, 'RESOLVED');
    assert.ok(persisted.assessment);

    const actionLogRepository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(actionLogRepository));
    const mlEvents = await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: mlInput.resourceId,
      findingKey: mlInput.findingKey,
      correlationId: mlInput.correlationId,
      recommendationId: mlInput.recommendationId,
      workflowId: SPRINT3_WORKFLOW_ID,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: mlInput.correlationId,
        recommendationId: mlInput.recommendationId,
        workflowId: SPRINT3_WORKFLOW_ID,
      },
    });
    const verificationEvents = await emitter.emitAfterPostActionVerification({
      assessment,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: mlInput.resourceId,
      findingKey: SPRINT3_FINDING_KEY,
      correlationId: mlInput.correlationId,
      recommendationId: mlInput.recommendationId,
      workflowId: SPRINT3_WORKFLOW_ID,
      executionId: verificationFixture.executionResult.executionId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: mlInput.correlationId,
        recommendationId: mlInput.recommendationId,
        workflowId: SPRINT3_WORKFLOW_ID,
      },
    });

    const lifecycle = buildSprint3LifecycleResult({
      recommendation: readiness.recommendationCategory,
      persistence: readiness.persistence.state,
      persistenceDurationHours: readiness.persistence.persistenceHours ?? 72,
      maturity: readiness.maturity?.maturity ?? 'MATURE',
      governance: readiness.governance.convergence.state,
      confidenceLabel: readiness.confidence.status,
      confidenceScore: readiness.confidence.score,
      decisionReadiness: readiness,
      mlDecision: decision,
      actionPolicy: policy,
      approvalRequired: true,
      approvalStatus: 'APPROVED',
      executionMode: 'SIMULATED',
      verification: assessment,
      reasonCodes: assessment.reasonCodes,
      correlationId: mlInput.correlationId,
      workflowId: SPRINT3_WORKFLOW_ID,
      executionId: verificationFixture.executionResult.executionId,
      decisionId: 'decision-cross-module-golden',
      actionLogSourceRecordIds: [
        ...mlEvents.map((entry) => entry.event.sourceRecordId),
        ...verificationEvents.map((entry) => entry.event.sourceRecordId),
      ],
    });

    assert.equal(lifecycle.ml.eligibility, 'ML_ELIGIBLE');
    assert.equal(lifecycle.verification.outcome, 'RESOLVED');
    assert.match(lifecycle.confidence, /^HIGH — 100$/);

    const reconstructed = await actionLogRepository.listByCorrelation(
      TENANT_A,
      mlInput.correlationId,
    );
    assert.ok(reconstructed.items.some((event) => event.eventType === 'ML_EXECUTED'));
    assert.ok(
      reconstructed.items.some((event) => event.eventType === 'VERIFICATION_COMPLETED'),
    );
  });
});
