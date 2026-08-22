import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateActionPolicyActorGate,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import { GOVERNANCE_CONTRADICTION } from '../../governance-regression/reason-codes';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { evaluatePostActionVerification } from '../../post-action-verification/evaluate-post-action-verification';
import { ExecutionApiService } from '../../services/execution-api-service';
import { ExecutionOrchestrator } from '../../execution/execution-orchestrator';
import { VERIFICATION_STATUS } from '../../shared/constants';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import {
  buildMlDecisionEvaluateInput,
  buildMlEligibleExecutedDecision,
} from '../fixtures/evidence/ml-fixtures';
import { buildMlHighNonAuthorityInput } from '../fixtures/sprint-4-governance/governance-regression-fixtures';
import { buildPostActionAssessmentInput } from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

const BACKEND_ROOT = process.cwd();

function readBackendSource(relativePath: string): string {
  return readFileSync(path.join(BACKEND_ROOT, relativePath), 'utf8');
}

describe('Sprint 4 ML non-authority release gate', () => {
  it('ML cannot set READY', () => {
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
  });

  it('ML cannot set APPROVED or change approvalRequired', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(buildMlEligibleExecutedDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });
    assert.equal(policy.approval, 'REQUIRED');
    assert.notEqual(policy.approval, 'APPROVED' as never);
    assert.ok(policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY));
  });

  it('ML cannot invoke ExecutionApiService or ExecutionOrchestrator', () => {
    const apiMethods = Object.getOwnPropertyNames(ExecutionApiService.prototype);
    const orchestratorMethods = Object.getOwnPropertyNames(
      ExecutionOrchestrator.prototype,
    );
    assert.ok(!apiMethods.some((name) => /infer|mlDecision|evaluateMl/i.test(name)));
    assert.ok(
      !orchestratorMethods.some((name) => /infer|mlDecision|evaluateMl/i.test(name)),
    );

    const mlSources = [
      'ml-decision/ml-decision-service.ts',
      'ml-decision/eligibility-policy.ts',
      'ml-decision/output-validation.ts',
      'ml-decision/adapters/ml-inference-adapter.ts',
      'ml-decision/adapters/mock-ml-inference-adapter.ts',
      'ml-production-qualification/qualify-ml-production.ts',
    ];
    for (const source of mlSources) {
      const contents = readBackendSource(source);
      assert.doesNotMatch(contents, /execution-api-service/);
      assert.doesNotMatch(contents, /execution-orchestrator/);
      assert.doesNotMatch(contents, /@aws-sdk\//);
      assert.doesNotMatch(contents, /rollbackPlan|rollbackRun/);
    }
  });

  it('ML cannot invoke AWS adapters from the inference boundary', () => {
    const adapter = readBackendSource('ml-decision/adapters/ml-inference-adapter.ts');
    const factory = readBackendSource('services/ml-inference-adapter-factory.ts');
    assert.doesNotMatch(adapter, /SageMaker|Bedrock|Comprehend/);
    assert.doesNotMatch(factory, /SageMaker|Bedrock|Comprehend|@aws-sdk\//);
  });

  it('ML cannot invoke rollback', () => {
    const qualification = qualifyGovernanceSafety({
      ...buildMlHighNonAuthorityInput(),
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: true,
        rollbackInvokedByVerification: false,
        rollbackActorAuthorized: true,
        rollbackMfaVerified: true,
        rollbackAttributionPresent: true,
        mlAuthorizedRollback: true,
      },
    });
    assert.equal(qualification.result, 'BLOCKED');
    assert.ok(
      qualification.contradictions?.some(
        (item) =>
          item.code === GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_AUTHORIZED_ROLLBACK,
      ),
    );
  });

  it('ML cannot bypass MFA or tenant authorization', () => {
    const mfa = evaluateActionPolicyActorGate({
      authorized: true,
      mfaVerified: false,
      privilegedActionRequired: true,
    });
    const auth = evaluateActionPolicyActorGate({
      authorized: false,
      mfaVerified: true,
      privilegedActionRequired: true,
    });
    assert.equal(mfa.permitted, false);
    assert.equal(auth.permitted, false);
    assert.ok(mfa.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
    assert.ok(auth.reasonCodes.includes(ACTION_POLICY_REASON.AUTHORIZATION_BLOCKED));
  });

  it('ML cannot turn failed verification into success', async () => {
    const { decision } = await new MlDecisionService(
      new MockMlInferenceAdapter({ confidence: 0.99 }),
    ).evaluate(buildMlDecisionEvaluateInput());

    const assessment = evaluatePostActionVerification({
      ...buildPostActionAssessmentInput({
        recommendationState: {
          findingKey: 'finding-ml-golden',
          recommendationId: 'rec-ml-golden',
          present: true,
          sufficientEvidence: true,
        },
      }),
      comparatorResult: {
        status: VERIFICATION_STATUS.FAILED,
        expectedSavings: 15,
        actualSavings: 0,
        verifiedSavings: 0,
        variance: -15,
        variancePercentage: -100,
        stateMatched: false,
        confidenceScore: 10,
        message: 'failed',
      },
    });

    assert.equal(decision.outcome, 'EXECUTED');
    assert.notEqual(assessment.outcome, 'RESOLVED');
    assert.notEqual(assessment.outcome, 'HEALTHY');
    assert.ok(
      assessment.outcome === 'DEGRADED' ||
        assessment.outcome === 'ROLLBACK_CANDIDATE' ||
        assessment.outcome === 'INSUFFICIENT_EVIDENCE',
    );
  });

  it('governance regression blocks ML authority claims', () => {
    const qualification = qualifyGovernanceSafety(buildMlHighNonAuthorityInput());
    assert.equal(qualification.result, 'BLOCKED');
    assert.ok(
      qualification.contradictions?.some(
        (item) =>
          item.code ===
          GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_EXECUTED_IS_AUTHORITY,
      ),
    );
  });
});
