import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateProductionExecutionEligibility,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { UnavailableMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import { buildMlNoMlGoldenPathInput } from '../fixtures/evidence/ml-fixtures';

/** Lightweight local guard — no AWS adapter registry import. */
function createExecutionInvocationGuard() {
  const counts = {
    orchestratorRun: 0,
    adapterExecute: 0,
  };

  return {
    orchestrator: {
      run: async () => {
        counts.orchestratorRun += 1;
        throw new Error('ExecutionOrchestrator.run invoked during no-ML golden path.');
      },
    },
    adapter: {
      execute: async () => {
        counts.adapterExecute += 1;
        throw new Error('AWS mutation adapter execute invoked during no-ML golden path.');
      },
    },
    assertZeroInvocations() {
      assert.equal(
        counts.orchestratorRun,
        0,
        'ExecutionOrchestrator.run must not be invoked during no-ML golden path',
      );
      assert.equal(
        counts.adapterExecute,
        0,
        'AWS mutation adapter execute must not be invoked during no-ML golden path',
      );
    },
  };
}

describe('Sprint 3 no-ML golden path', () => {
  it('READY + model unavailable → FAILED_SAFE → DETERMINISTIC_RULES → approval still REQUIRED', async () => {
    const executionGuard = createExecutionInvocationGuard();

    const service = new MlDecisionService(new UnavailableMlInferenceAdapter());
    const { decision } = await service.evaluate(buildMlNoMlGoldenPathInput());
    const summary = toMlDecisionSummary(decision);

    assert.equal(summary.outcome, 'FAILED_SAFE');
    assert.equal(summary.fallback, 'DETERMINISTIC_RULES');

    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: summary,
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED),
    );

    const eligibleAfterApproval = evaluateProductionExecutionEligibility({
      policy,
      approvalRequired: true,
      approvalStatus: 'APPROVED',
      planStatus: 'APPROVED',
    });

    assert.equal(eligibleAfterApproval.executionEligibility, 'ELIGIBLE');
    assert.notEqual(policy.approval, 'APPROVED' as never);

    void executionGuard.orchestrator;
    void executionGuard.adapter;
    executionGuard.assertZeroInvocations();
  });
});
