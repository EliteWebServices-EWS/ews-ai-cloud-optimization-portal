import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateProductionExecutionEligibility,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { UnavailableMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
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
import { buildMlNoMlGoldenPathInput, buildReadySprint2DecisionReadiness } from '../fixtures/evidence/ml-fixtures';
import {
  buildExecutionApiSuccessRecommendationResolvedInput,
  SPRINT3_FINDING_KEY,
  SPRINT3_WORKFLOW_ID,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Sprint 3 no-ML verification golden path', () => {
  it('model unavailable → deterministic fallback → approval preserved → verification → ActionLog', async () => {
    const mlService = new MlDecisionService(new UnavailableMlInferenceAdapter());
    const { decision } = await mlService.evaluate(buildMlNoMlGoldenPathInput());
    const summary = toMlDecisionSummary(decision);

    assert.equal(summary.outcome, 'FAILED_SAFE');
    assert.equal(summary.fallback, 'DETERMINISTIC_RULES');

    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: {
        readiness: 'READY',
        reasonCodes: decision.reasonCodes,
        policyVersion: decision.eligibilityPolicyVersion,
        recommendedAction: 'RESIZE_INSTANCE',
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
    const { assessment } = await verificationService.evaluateAndPersist({
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
    assert.notEqual(assessment.outcome, 'HEALTHY');

    const actionLogRepository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(actionLogRepository));
    const mlEvents = await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: buildMlNoMlGoldenPathInput().resourceId,
      findingKey: buildMlNoMlGoldenPathInput().findingKey,
      correlationId: buildMlNoMlGoldenPathInput().correlationId,
      recommendationId: buildMlNoMlGoldenPathInput().recommendationId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: buildMlNoMlGoldenPathInput().correlationId,
        recommendationId: buildMlNoMlGoldenPathInput().recommendationId,
      },
    });
    const verificationEvents = await emitter.emitAfterPostActionVerification({
      assessment,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: verificationFixture.executionResult.resourceId,
      findingKey: SPRINT3_FINDING_KEY,
      correlationId: buildMlNoMlGoldenPathInput().correlationId,
      recommendationId: buildMlNoMlGoldenPathInput().recommendationId,
      workflowId: SPRINT3_WORKFLOW_ID,
      executionId: verificationFixture.executionResult.executionId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: buildMlNoMlGoldenPathInput().correlationId,
        recommendationId: buildMlNoMlGoldenPathInput().recommendationId,
      },
    });

    const readiness = buildReadySprint2DecisionReadiness();
    const lifecycle = buildSprint3LifecycleResult({
      recommendation: 'BURSTABLE_CREDIT_PRESSURE',
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
      correlationId: buildMlNoMlGoldenPathInput().correlationId,
      workflowId: SPRINT3_WORKFLOW_ID,
      executionId: verificationFixture.executionResult.executionId,
      decisionId: 'decision-no-ml-golden',
      actionLogSourceRecordIds: [
        ...mlEvents.map((entry) => entry.event.sourceRecordId),
        ...verificationEvents.map((entry) => entry.event.sourceRecordId),
      ],
    });

    assert.equal(lifecycle.ml.outcome, 'FAILED_SAFE');
    assert.equal(lifecycle.verification.outcome, 'RESOLVED');
    assert.ok(lifecycle.lifecycle.actionLogSourceRecordIds.length >= 4);

    const reconstructed = await actionLogRepository.listByCorrelation(
      TENANT_A,
      buildMlNoMlGoldenPathInput().correlationId,
    );
    assert.ok(reconstructed.items.length >= 4);
  });
});
