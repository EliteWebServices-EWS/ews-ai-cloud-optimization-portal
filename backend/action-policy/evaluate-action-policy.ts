import { ACTION_POLICY_VERSION } from './model-version';
import { ACTION_POLICY_REASON } from './reason-codes';
import type {
  ActionPolicyActorGateInput,
  ActionPolicyActorGateResult,
  ActionPolicyResult,
  EvaluateActionPolicyInput,
} from './types';

function uniqueReasons(
  codes: Array<(typeof ACTION_POLICY_REASON)[keyof typeof ACTION_POLICY_REASON]>,
): ActionPolicyResult['reasonCodes'] {
  return [...new Set(codes)];
}

function applyMlBoundary(
  input: EvaluateActionPolicyInput,
  base: Pick<ActionPolicyResult, 'approval' | 'executionEligibility' | 'reasonCodes'>,
): Pick<ActionPolicyResult, 'approval' | 'executionEligibility' | 'reasonCodes'> {
  const ml = input.mlDecisionSummary;
  if (!ml) {
    return base;
  }

  const reasonCodes = [...base.reasonCodes];

  if (ml.outcome === 'FAILED_SAFE') {
    reasonCodes.push(ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED);
    return {
      approval: base.approval,
      executionEligibility: base.executionEligibility,
      reasonCodes: uniqueReasons(reasonCodes),
    };
  }

  if (ml.outcome === 'EXECUTED') {
    reasonCodes.push(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY);
  }

  if (ml.eligibility === 'ML_INELIGIBLE' && ml.outcome === 'SKIPPED') {
    if (ml.fallback === 'DETERMINISTIC_RULES') {
      reasonCodes.push(ACTION_POLICY_REASON.ML_DETERMINISTIC_FALLBACK_PERMITTED);
      return {
        approval: base.approval,
        executionEligibility: base.executionEligibility,
        reasonCodes: uniqueReasons(reasonCodes),
      };
    }

    if (ml.fallback === 'REJECT') {
      return {
        approval: 'BLOCKED',
        executionEligibility: 'NOT_ELIGIBLE',
        reasonCodes: uniqueReasons([
          ...reasonCodes,
          ACTION_POLICY_REASON.ML_FALLBACK_REJECT_BLOCKED,
        ]),
      };
    }

    reasonCodes.push(ACTION_POLICY_REASON.ML_INELIGIBLE_NO_FALLBACK);
  }

  return {
    approval: base.approval,
    executionEligibility: base.executionEligibility,
    reasonCodes: uniqueReasons(reasonCodes),
  };
}

/**
 * Deterministic Sprint 3 action policy. Consumes authoritative readiness only.
 * ML influences reason codes but never sets APPROVED or EXECUTED.
 */
export function evaluateActionPolicy(
  input: EvaluateActionPolicyInput,
): ActionPolicyResult {
  const proposedAction = input.decisionReadiness.recommendedAction;
  const baseResult: ActionPolicyResult = {
    policyVersion: ACTION_POLICY_VERSION,
    evaluatedAt: input.evaluatedAt,
    decisionReadiness: input.decisionReadiness.readiness,
    mlDecisionSummary: input.mlDecisionSummary,
    proposedAction,
    actionMode: input.actionMode,
    approval: 'NOT_REQUIRED',
    executionEligibility: 'NOT_ELIGIBLE',
    reasonCodes: [],
  };

  if (input.decisionReadiness.readiness === 'NOT_READY') {
    return {
      ...baseResult,
      approval: 'BLOCKED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: [ACTION_POLICY_REASON.READINESS_NOT_READY_BLOCKED],
    };
  }

  baseResult.reasonCodes = [ACTION_POLICY_REASON.READINESS_READY];

  if (input.actionMode === 'SIMULATION') {
    const simulationBase = applyMlBoundary(input, {
      approval: 'NOT_REQUIRED',
      executionEligibility: 'ELIGIBLE',
      reasonCodes: uniqueReasons([
        ACTION_POLICY_REASON.READINESS_READY,
        ACTION_POLICY_REASON.SIMULATION_ALLOWED,
        ACTION_POLICY_REASON.SIMULATION_NOT_PRODUCTION,
        ACTION_POLICY_REASON.APPROVAL_NOT_REQUIRED,
      ]),
    });

    return {
      ...baseResult,
      ...simulationBase,
    };
  }

  if (input.infrastructureChanging) {
    const productionBase = applyMlBoundary(input, {
      approval: 'REQUIRED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: uniqueReasons([
        ACTION_POLICY_REASON.READINESS_READY,
        ACTION_POLICY_REASON.PRODUCTION_INFRA_APPROVAL_REQUIRED,
        ACTION_POLICY_REASON.PRODUCTION_INFRA_NOT_APPROVED,
      ]),
    });

    return {
      ...baseResult,
      ...productionBase,
    };
  }

  const nonInfraProduction = applyMlBoundary(input, {
    approval: 'NOT_REQUIRED',
    executionEligibility: 'ELIGIBLE',
    reasonCodes: uniqueReasons([
      ACTION_POLICY_REASON.READINESS_READY,
      ACTION_POLICY_REASON.APPROVAL_NOT_REQUIRED,
      ACTION_POLICY_REASON.PRODUCTION_APPROVED_ELIGIBLE,
    ]),
  });

  return {
    ...baseResult,
    ...nonInfraProduction,
  };
}

export function evaluateProductionExecutionEligibility(input: {
  policy: ActionPolicyResult;
  approvalRequired: boolean;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  planStatus: string;
}): ActionPolicyResult {
  if (input.policy.actionMode !== 'PRODUCTION') {
    return input.policy;
  }

  if (input.planStatus === 'REJECTED' || input.approvalStatus === 'REJECTED') {
    return {
      ...input.policy,
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: uniqueReasons([
        ...input.policy.reasonCodes,
        ACTION_POLICY_REASON.PRODUCTION_REJECTED_BLOCKED,
      ]),
    };
  }

  if (input.policy.approval === 'BLOCKED') {
    return {
      ...input.policy,
      executionEligibility: 'NOT_ELIGIBLE',
    };
  }

  if (input.approvalRequired) {
    if (input.approvalStatus !== 'APPROVED') {
      return {
        ...input.policy,
        executionEligibility: 'NOT_ELIGIBLE',
        reasonCodes: uniqueReasons([
          ...input.policy.reasonCodes,
          ACTION_POLICY_REASON.PRODUCTION_INFRA_NOT_APPROVED,
        ]),
      };
    }

    return {
      ...input.policy,
      executionEligibility: 'ELIGIBLE',
      reasonCodes: uniqueReasons([
        ...input.policy.reasonCodes,
        ACTION_POLICY_REASON.PRODUCTION_APPROVED_ELIGIBLE,
      ]),
    };
  }

  return {
    ...input.policy,
    executionEligibility: 'ELIGIBLE',
    reasonCodes: uniqueReasons([
      ...input.policy.reasonCodes,
      ACTION_POLICY_REASON.PRODUCTION_APPROVED_ELIGIBLE,
    ]),
  };
}

export function evaluateActionPolicyActorGate(
  input: ActionPolicyActorGateInput,
): ActionPolicyActorGateResult {
  const reasonCodes: ActionPolicyActorGateResult['reasonCodes'] = [];

  if (!input.authorized) {
    reasonCodes.push(ACTION_POLICY_REASON.AUTHORIZATION_BLOCKED);
  }

  if (input.privilegedActionRequired && !input.mfaVerified) {
    reasonCodes.push(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED);
  }

  return {
    permitted: reasonCodes.length === 0,
    reasonCodes,
  };
}
