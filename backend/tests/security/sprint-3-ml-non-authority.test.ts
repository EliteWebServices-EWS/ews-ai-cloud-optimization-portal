import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateActionPolicyActorGate,
  evaluateProductionExecutionEligibility,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { ActionLogPersistenceError } from '../../action-log/errors';
import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { ExecutionApiService } from '../../services/execution-api-service';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import {
  buildAvailableMlModel,
  buildCompleteMlFeatureManifest,
  buildMlDecisionEvaluateInput,
  buildMlEligibleExecutedDecision,
  buildMlNoMlGoldenPathInput,
  buildReadySprint2DecisionReadiness,
} from '../fixtures/evidence/ml-fixtures';

describe('Sprint 3 ML non-authority security', () => {
  it('ML EXECUTED cannot set APPROVED in Action Policy', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(buildMlEligibleExecutedDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    assert.notEqual(policy.approval, 'APPROVED' as never);
  });

  it('ML EXECUTED outcome is not production execution eligibility', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(buildMlEligibleExecutedDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY));
  });

  it('ML FAILED_SAFE cannot weaken approval requirements', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: {
        eligibility: 'ML_ELIGIBLE',
        outcome: 'FAILED_SAFE',
        fallback: 'DETERMINISTIC_RULES',
      },
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    assert.ok(
      policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED),
    );
  });

  it('ML high confidence EXECUTED cannot bypass Action Policy approval', () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.99 }));
    return service.evaluate(buildMlDecisionEvaluateInput()).then(({ decision }) => {
      const policy = evaluateActionPolicy({
        evaluatedAt: FIXED_POLICY_EVALUATED_AT,
        decisionReadiness: buildReadyReadinessInput(),
        mlDecisionSummary: toMlDecisionSummary(decision),
        actionMode: 'PRODUCTION',
        infrastructureChanging: true,
      });

      assert.equal(decision.outcome, 'EXECUTED');
      assert.equal(policy.approval, 'REQUIRED');
    });
  });

  it('ML cannot convert NOT_READY into READY', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: {
        ...buildReadyReadinessInput(),
        readiness: 'NOT_READY',
      },
      mlDecisionSummary: toMlDecisionSummary(buildMlEligibleExecutedDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.decisionReadiness, 'NOT_READY');
    assert.equal(policy.approval, 'BLOCKED');
  });

  it('ML cannot bypass MFA actor gate', () => {
    const gate = evaluateActionPolicyActorGate({
      authorized: true,
      mfaVerified: false,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
  });

  it('ML cannot bypass execution authorization actor gate', () => {
    const gate = evaluateActionPolicyActorGate({
      authorized: false,
      mfaVerified: true,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.AUTHORIZATION_BLOCKED));
  });

  it('ExecutionApiService does not expose ML inference entrypoints', () => {
    const methods = Object.getOwnPropertyNames(ExecutionApiService.prototype);
    assert.ok(!methods.some((name) => /infer|mlDecision/i.test(name)));
  });

  it('MLDecision top-level provenance excludes secret-like field names', () => {
    const decision = buildMlEligibleExecutedDecision();
    const keys = Object.keys(decision).join('|');
    assert.ok(!/secret|token|authorization|mfa/i.test(keys));
  });

  it('approved production execution still requires explicit approval status', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(buildMlEligibleExecutedDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    const withoutApproval = evaluateProductionExecutionEligibility({
      policy,
      approvalRequired: true,
      approvalStatus: 'PENDING',
      planStatus: 'PENDING_APPROVAL',
    });

    assert.equal(withoutApproval.executionEligibility, 'NOT_ELIGIBLE');
  });
});

describe('Sprint 3 ML failure matrix', () => {
  it('invalid evidence → ML_INELIGIBLE + REJECT fallback path', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter());
    const { decision } = await service.evaluate(
      buildMlDecisionEvaluateInput({
        decisionReadiness: buildReadySprint2DecisionReadiness({
          validation: { valid: false },
        }),
      }),
    );

    assert.equal(decision.eligibility, 'ML_INELIGIBLE');
    assert.equal(decision.fallback, 'REJECT');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_INVALID),
    );
  });

  it('telemetry quality inadequate → ML_INELIGIBLE', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter());
    const { decision } = await service.evaluate(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          telemetryQualityAdequate: false,
        }),
      }),
    );

    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_TELEMETRY_QUALITY),
    );
  });

  it('model version incompatible → ML_INELIGIBLE before inference', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter());
    const { decision } = await service.evaluate(
      buildMlDecisionEvaluateInput({
        modelAvailability: buildAvailableMlModel({ compatible: false }),
      }),
    );

    assert.equal(decision.outcome, 'SKIPPED');
    assert.ok(
      decision.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_MODEL_VERSION_INCOMPATIBLE,
      ),
    );
  });

  it('Infinity confidence → FAILED_SAFE invalid output', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ confidence: Number.POSITIVE_INFINITY }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT),
    );
  });

  it('ActionLog persistence failure surfaces without mutating MLDecision', async () => {
    const failingRepository = {
      recordEvent: async () => {
        throw new Error('dynamodb unavailable');
      },
      getEvent: async () => null,
      listByDecision: async () => ({ items: [] }),
      listByResource: async () => ({ items: [] }),
      listByCorrelation: async () => ({ items: [] }),
      listByExecution: async () => ({ items: [] }),
    };
    const emitter = new ActionLogEmitter(new ActionLogService(failingRepository));
    const service = new MlDecisionService(new MockMlInferenceAdapter({ unavailable: true }));
    const input = buildMlNoMlGoldenPathInput();
    const { decision } = await service.evaluate(input);

    await assert.rejects(
      () =>
        emitter.emitAfterMlDecision({
          decision,
          tenantId: input.tenantId,
          accountId: input.accountId,
          resourceId: input.resourceId,
          findingKey: input.findingKey,
          correlationId: input.correlationId,
          recommendationId: input.recommendationId,
          context: {
            tenantId: input.tenantId,
            accountId: input.accountId,
            correlationId: input.correlationId,
            recommendationId: input.recommendationId,
          },
        }),
      ActionLogPersistenceError,
    );

    assert.equal(decision.outcome, 'FAILED_SAFE');
  });

  it('duplicate ML ActionLog emission remains idempotent', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const service = new MlDecisionService(new MockMlInferenceAdapter({ unavailable: true }));
    const input = buildMlNoMlGoldenPathInput();
    const { decision } = await service.evaluate(input);
    const payload = {
      decision,
      tenantId: input.tenantId,
      accountId: input.accountId,
      resourceId: input.resourceId,
      findingKey: input.findingKey,
      correlationId: input.correlationId,
      recommendationId: input.recommendationId,
      context: {
        tenantId: input.tenantId,
        accountId: input.accountId,
        correlationId: input.correlationId,
        recommendationId: input.recommendationId,
      },
    };

    const first = await emitter.emitAfterMlDecision(payload);
    const second = await emitter.emitAfterMlDecision(payload);

    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.equal(first[1]?.created, true);
    assert.equal(second[1]?.created, false);
  });
});
