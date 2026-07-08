import type { GovernanceResult, PolicyResult, ReadinessResult } from '../../shared/types';
import { GOVERNANCE_STATUS, POLICY_STATUS } from '../../shared/constants';
import type { GovernanceConfig } from './governance.config';
import { GOVERNANCE_RULES, type GovernanceRuleContext } from './governance.rules';

/**
 * Evaluate all governance policy rules against the provided context.
 * Returns individual policy results for aggregation by the Governance Engine.
 */
export function evaluatePolicies(context: GovernanceRuleContext): PolicyResult[] {
  return GOVERNANCE_RULES.map((rule) => rule.evaluate(context));
}

/**
 * Derive the governance decision from policy evaluation results and readiness.
 */
export function deriveGovernanceDecision(
  policies: PolicyResult[],
  readiness: ReadinessResult,
  config: GovernanceConfig
): Pick<GovernanceResult, 'decision' | 'reason' | 'approver'> {
  const criticalFailures = policies.filter(
    (policy) =>
      policy.status === POLICY_STATUS.FAIL &&
      (policy.severity === 'CRITICAL' || policy.severity === 'HIGH')
  );

  if (criticalFailures.length > 0) {
    return {
      decision: GOVERNANCE_STATUS.REJECTED,
      reason: criticalFailures.map((policy) => policy.reason).join('; '),
    };
  }

  if (readiness.status === 'NOT_READY') {
    return {
      decision: GOVERNANCE_STATUS.REJECTED,
      reason: `Evidence not ready for optimization (readiness score: ${readiness.score})`,
    };
  }

  const approvalPolicy = policies.find((policy) => policy.name === 'environment-approval');
  const requiresApproval =
    approvalPolicy?.status === POLICY_STATUS.WARN &&
    approvalPolicy.reason.includes('requires manual approval');

  if (requiresApproval) {
    return {
      decision: GOVERNANCE_STATUS.NEEDS_APPROVAL,
      reason: approvalPolicy!.reason,
      approver: config.defaultApprover,
    };
  }

  const warnings = policies.filter((policy) => policy.status === POLICY_STATUS.WARN);
  if (readiness.status === 'PARTIALLY_READY') {
    return {
      decision: GOVERNANCE_STATUS.NEEDS_APPROVAL,
      reason:
        warnings.length > 0
          ? `Partially ready (score: ${readiness.score}) — ${warnings[0]!.reason}`
          : `Partially ready (score: ${readiness.score}) — manual review recommended`,
      approver: config.defaultApprover,
    };
  }

  return {
    decision: GOVERNANCE_STATUS.APPROVED,
    reason:
      warnings.length > 0
        ? `Approved with ${warnings.length} advisory warning(s)`
        : 'All governance policies passed',
  };
}
