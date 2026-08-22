import type { DecisionLifecycleSnapshot } from '../../../governance-regression-eng2/types';
import { ACCOUNT_A, ACCOUNT_B, TENANT_A, TENANT_B } from '../evidence/identities';

export const FIXED_REGRESSION_EVALUATED_AT = '2026-08-21T12:00:00.000Z';

/**
 * A fully READY, fully governed, SAFE-by-default decision snapshot. Every
 * regression scenario below is expressed as a deviation from this baseline
 * so each fixture only encodes the single condition it exists to test.
 */
export function buildSafeBaselineSnapshot(
  overrides: Partial<DecisionLifecycleSnapshot> = {},
): DecisionLifecycleSnapshot {
  return {
    decisionId: 'decision-1',
    correlationId: 'corr-1',
    scope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    observedRecordScopes: [{ tenantId: TENANT_A, accountId: ACCOUNT_A }],
    evaluatedAt: FIXED_REGRESSION_EVALUATED_AT,
    evidenceMaturity: { available: true, maturity: 'MATURE' },
    governance: { contextAvailable: true, convergenceState: 'PRESERVED', legacyStatus: null },
    confidence: { available: true, status: 'HIGH' },
    decisionReadiness: { available: true, readiness: 'READY' },
    mlDecision: { present: false, outcome: null, actionPolicyRecordedNonAuthority: false },
    actionPolicy: {
      available: true,
      approval: 'NOT_REQUIRED',
      executionEligibility: 'ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_READINESS_READY', 'ACTION_POLICY_APPROVAL_NOT_REQUIRED'],
    },
    approval: {
      available: true,
      approvalStatus: 'NOT_REQUIRED',
      approvalSource: 'NOT_APPLICABLE',
      approvalActorId: null,
      approvedAt: null,
    },
    execution: { attempted: true, apiSuccess: true, providerFailure: false },
    verification: {
      present: true,
      outcome: 'RESOLVED',
      incorrectlyMarkedResolved: false,
    },
    rollback: {
      candidateFlagged: false,
      evidenceSufficient: null,
      authorized: false,
      authorizedByActorId: null,
      authorizedAt: null,
      authorizedByMl: false,
      authorizedByVerificationDirectly: false,
    },
    ...overrides,
  };
}

/** 1. recommendation without mature evidence */
export function scenarioRecommendationWithoutMatureEvidence(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    evidenceMaturity: { available: true, maturity: 'IMMATURE' },
    decisionReadiness: { available: true, readiness: 'NOT_READY' },
    actionPolicy: {
      available: true,
      approval: 'BLOCKED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_READINESS_NOT_READY_BLOCKED'],
    },
    approval: {
      available: true,
      approvalStatus: 'NOT_REQUIRED',
      approvalSource: 'NOT_APPLICABLE',
      approvalActorId: null,
      approvedAt: null,
    },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 2. mature evidence + governance failure */
export function scenarioMatureEvidenceGovernanceFailure(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    evidenceMaturity: { available: true, maturity: 'MATURE' },
    governance: { contextAvailable: true, convergenceState: 'MISSING', legacyStatus: null },
    decisionReadiness: { available: true, readiness: 'NOT_READY' },
    actionPolicy: {
      available: true,
      approval: 'BLOCKED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_READINESS_NOT_READY_BLOCKED'],
    },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 3. governance pass + insufficient confidence */
export function scenarioGovernancePassInsufficientConfidence(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    confidence: { available: true, status: 'MEDIUM' },
    decisionReadiness: { available: true, readiness: 'NOT_READY' },
    actionPolicy: {
      available: true,
      approval: 'BLOCKED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_READINESS_NOT_READY_BLOCKED'],
    },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 4. NOT_READY + high ML confidence (ML must not manufacture eligibility) */
export function scenarioNotReadyHighMlConfidence(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    decisionReadiness: { available: true, readiness: 'NOT_READY' },
    mlDecision: { present: true, outcome: 'EXECUTED', actionPolicyRecordedNonAuthority: true },
    actionPolicy: {
      available: true,
      // Deliberately corrupted: eligibility flipped to ELIGIBLE despite NOT_READY
      // readiness, to prove the gate catches it even when the ML reason code
      // was correctly recorded.
      approval: 'NOT_REQUIRED',
      executionEligibility: 'ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_ML_EXECUTED_NON_AUTHORITY'],
    },
    execution: { attempted: true, apiSuccess: true, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 5. ML unavailable — deterministic path must still hold */
export function scenarioMlUnavailable(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    mlDecision: { present: false, outcome: null, actionPolicyRecordedNonAuthority: false },
  });
}

/** 6. ML corrupt output — must resolve to FAILED_SAFE and leave policy unchanged */
export function scenarioMlCorruptOutput(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    mlDecision: { present: true, outcome: 'FAILED_SAFE', actionPolicyRecordedNonAuthority: false },
    actionPolicy: {
      available: true,
      approval: 'NOT_REQUIRED',
      executionEligibility: 'ELIGIBLE',
      reasonCodes: [
        'ACTION_POLICY_READINESS_READY',
        'ACTION_POLICY_ML_FAILED_SAFE_APPROVAL_UNCHANGED',
      ],
    },
  });
}

/** 7. pricing unavailable — modeled as evidence maturity unavailable upstream */
export function scenarioPricingUnavailable(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    evidenceMaturity: { available: false, maturity: null },
    decisionReadiness: { available: false, readiness: null },
    actionPolicy: { available: false, approval: null, executionEligibility: null, reasonCodes: [] },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 8. telemetry unavailable — same evidence-incompleteness shape as pricing */
export function scenarioTelemetryUnavailable(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    decisionReadiness: { available: false, readiness: null },
    actionPolicy: { available: false, approval: null, executionEligibility: null, reasonCodes: [] },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 9. missing approval */
export function scenarioMissingApproval(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    actionPolicy: {
      available: true,
      approval: 'REQUIRED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_PRODUCTION_INFRA_APPROVAL_REQUIRED'],
    },
    approval: {
      available: true,
      approvalStatus: 'PENDING',
      approvalSource: 'NOT_APPLICABLE',
      approvalActorId: null,
      approvedAt: null,
    },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 10. rejected approval */
export function scenarioRejectedApproval(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    actionPolicy: {
      available: true,
      approval: 'REQUIRED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_PRODUCTION_REJECTED_BLOCKED'],
    },
    approval: {
      available: true,
      approvalStatus: 'REJECTED',
      approvalSource: 'HUMAN_APPROVAL',
      approvalActorId: 'actor-reviewer',
      approvedAt: FIXED_REGRESSION_EVALUATED_AT,
    },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 11. stale approval — recorded APPROVED but against a superseded plan version */
export function scenarioStaleApproval(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    actionPolicy: {
      available: true,
      approval: 'REQUIRED',
      executionEligibility: 'NOT_ELIGIBLE',
      reasonCodes: ['ACTION_POLICY_STALE_PLAN_VERSION'],
    },
    approval: {
      available: true,
      approvalStatus: 'STALE',
      approvalSource: 'HUMAN_APPROVAL',
      approvalActorId: 'actor-reviewer',
      approvedAt: '2026-08-01T00:00:00.000Z',
    },
    execution: { attempted: false, apiSuccess: null, providerFailure: false },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 12. execution provider failure */
export function scenarioExecutionProviderFailure(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    execution: { attempted: true, apiSuccess: false, providerFailure: true },
    verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
  });
}

/** 13. verification insufficient */
export function scenarioVerificationInsufficient(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    verification: {
      present: true,
      outcome: 'INSUFFICIENT_EVIDENCE',
      incorrectlyMarkedResolved: false,
    },
  });
}

/** 14. post-action deterioration (DEGRADED) */
export function scenarioPostActionDeterioration(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    verification: { present: true, outcome: 'DEGRADED', incorrectlyMarkedResolved: false },
  });
}

/** 15. rollback candidate without authorization */
export function scenarioRollbackCandidateWithoutAuthorization(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    verification: {
      present: true,
      outcome: 'ROLLBACK_CANDIDATE',
      incorrectlyMarkedResolved: false,
    },
    rollback: {
      candidateFlagged: true,
      evidenceSufficient: true,
      authorized: false,
      authorizedByActorId: null,
      authorizedAt: null,
      authorizedByMl: false,
      authorizedByVerificationDirectly: false,
    },
  });
}

/** 16. cross-tenant decision input */
export function scenarioCrossTenantDecisionInput(): DecisionLifecycleSnapshot {
  return buildSafeBaselineSnapshot({
    observedRecordScopes: [
      { tenantId: TENANT_A, accountId: ACCOUNT_A },
      { tenantId: TENANT_B, accountId: ACCOUNT_B },
    ],
  });
}

export const REGRESSION_MATRIX_SCENARIOS = [
  { name: 'recommendation without mature evidence', build: scenarioRecommendationWithoutMatureEvidence, expected: 'SAFE' as const },
  { name: 'mature evidence + governance failure', build: scenarioMatureEvidenceGovernanceFailure, expected: 'SAFE' as const },
  { name: 'governance pass + insufficient confidence', build: scenarioGovernancePassInsufficientConfidence, expected: 'SAFE' as const },
  { name: 'NOT_READY + high ML confidence', build: scenarioNotReadyHighMlConfidence, expected: 'BLOCKED' as const },
  { name: 'ML unavailable', build: scenarioMlUnavailable, expected: 'SAFE' as const },
  { name: 'ML corrupt output', build: scenarioMlCorruptOutput, expected: 'SAFE' as const },
  { name: 'pricing unavailable', build: scenarioPricingUnavailable, expected: 'INSUFFICIENT_EVIDENCE' as const },
  { name: 'telemetry unavailable', build: scenarioTelemetryUnavailable, expected: 'INSUFFICIENT_EVIDENCE' as const },
  { name: 'missing approval', build: scenarioMissingApproval, expected: 'SAFE' as const },
  { name: 'rejected approval', build: scenarioRejectedApproval, expected: 'SAFE' as const },
  { name: 'stale approval', build: scenarioStaleApproval, expected: 'SAFE' as const },
  { name: 'execution provider failure', build: scenarioExecutionProviderFailure, expected: 'SAFE' as const },
  { name: 'verification insufficient', build: scenarioVerificationInsufficient, expected: 'SAFE' as const },
  { name: 'post-action deterioration', build: scenarioPostActionDeterioration, expected: 'SAFE' as const },
  { name: 'rollback candidate without authorization', build: scenarioRollbackCandidateWithoutAuthorization, expected: 'SAFE' as const },
  { name: 'cross-tenant decision input', build: scenarioCrossTenantDecisionInput, expected: 'BLOCKED' as const },
];
