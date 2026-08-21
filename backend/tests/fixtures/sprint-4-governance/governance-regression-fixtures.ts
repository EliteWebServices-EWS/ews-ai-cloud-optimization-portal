import type { GovernanceSafetyQualificationInput } from '../../../governance-regression/types';
import { ACCOUNT_A, TENANT_A } from '../evidence/identities';

export const GOVERNANCE_REGRESSION_EVALUATED_AT = '2026-08-21T12:00:00.000Z';

function baseInput(
  overrides: Partial<GovernanceSafetyQualificationInput> = {},
): GovernanceSafetyQualificationInput {
  const base: GovernanceSafetyQualificationInput = {
    evaluatedAt: GOVERNANCE_REGRESSION_EVALUATED_AT,
    scope: {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      scopeVerified: true,
    },
    intelligence: {
      maturity: 'MATURE',
      readiness: 'READY',
      governanceConvergenceState: 'PRESERVED',
      governanceContextAvailable: true,
      confidenceStatus: 'HIGH',
      pricingEvidenceAvailable: true,
      telemetryEvidenceAvailable: true,
    },
    policy: {
      actionPolicyApproval: 'REQUIRED',
      actionPolicyExecutionEligibility: 'NOT_ELIGIBLE',
      actionPolicyReadiness: 'READY',
      approvalRequired: true,
      approvalStatus: 'APPROVED',
      approvalActorAuthorized: true,
      approvalMfaVerified: true,
      approvalStale: false,
      claimsMlAuthority: false,
      claimsApprovedFromConfidence: false,
    },
    execution: {
      executionAttempted: false,
      executionApiSucceeded: false,
      optimizationVerified: false,
    },
    verification: {
      verificationEvidenceSufficient: true,
    },
    rollback: {
      rollbackCandidate: false,
      rollbackAuthorized: false,
      rollbackInvokedByVerification: false,
      rollbackActorAuthorized: true,
      rollbackMfaVerified: true,
      rollbackAttributionPresent: true,
      mlAuthorizedRollback: false,
    },
  };

  return {
    ...base,
    ...overrides,
    scope: { ...base.scope, ...overrides.scope },
    intelligence: { ...base.intelligence, ...overrides.intelligence },
    policy: { ...base.policy, ...overrides.policy },
    execution: { ...base.execution, ...overrides.execution },
    verification: { ...base.verification, ...overrides.verification },
    rollback: { ...base.rollback, ...overrides.rollback },
  };
}

export function buildSafeFullyConsistentInput(
  overrides: Partial<GovernanceSafetyQualificationInput> = {},
): GovernanceSafetyQualificationInput {
  return baseInput(overrides);
}

export function buildBlockedImmatureReadyContradictionInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    intelligence: {
      maturity: 'IMMATURE',
      readiness: 'READY',
      governanceConvergenceState: 'PRESERVED',
      governanceContextAvailable: true,
      confidenceStatus: 'HIGH',
      pricingEvidenceAvailable: true,
      telemetryEvidenceAvailable: true,
    },
  });
}

export function buildBlockedGovernanceFailExecutionEligibleInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    intelligence: {
      maturity: 'MATURE',
      readiness: 'READY',
      governanceConvergenceState: 'MISSING',
      governanceContextAvailable: true,
      confidenceStatus: 'HIGH',
      pricingEvidenceAvailable: true,
      telemetryEvidenceAvailable: true,
    },
    policy: {
      actionPolicyApproval: 'REQUIRED',
      actionPolicyExecutionEligibility: 'ELIGIBLE',
      actionPolicyReadiness: 'READY',
      approvalRequired: true,
      approvalStatus: 'APPROVED',
    },
  });
}

export function buildBlockedMissingApprovalInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    policy: {
      actionPolicyApproval: 'REQUIRED',
      actionPolicyExecutionEligibility: 'NOT_ELIGIBLE',
      actionPolicyReadiness: 'READY',
      approvalRequired: true,
      approvalStatus: 'PENDING',
    },
    execution: {
      executionAttempted: true,
      executionApiSucceeded: true,
      optimizationVerified: false,
    },
  });
}

export function buildBlockedRollbackWithoutAuthorizationInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    rollback: {
      rollbackCandidate: true,
      rollbackAuthorized: true,
      rollbackActorAuthorized: false,
      rollbackMfaVerified: false,
      rollbackAttributionPresent: false,
      mlAuthorizedRollback: false,
    },
  });
}

export function buildInsufficientMissingTelemetryInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    intelligence: {
      maturity: 'MATURE',
      readiness: 'NOT_READY',
      governanceConvergenceState: 'PRESERVED',
      governanceContextAvailable: true,
      confidenceStatus: 'HIGH',
      pricingEvidenceAvailable: true,
      telemetryEvidenceAvailable: false,
    },
  });
}

export function buildInsufficientMissingPricingInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    intelligence: {
      maturity: 'MATURE',
      readiness: 'NOT_READY',
      governanceConvergenceState: 'PRESERVED',
      governanceContextAvailable: true,
      confidenceStatus: 'HIGH',
      pricingEvidenceAvailable: false,
      telemetryEvidenceAvailable: true,
    },
  });
}

export function buildInsufficientVerificationEvidenceInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    verification: {
      postActionOutcome: 'INSUFFICIENT_EVIDENCE',
      verificationEvidenceSufficient: false,
    },
  });
}

export function buildMlHighNonAuthorityInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    policy: {
      actionPolicyApproval: 'REQUIRED',
      actionPolicyExecutionEligibility: 'ELIGIBLE',
      actionPolicyReadiness: 'READY',
      approvalRequired: true,
      approvalStatus: 'PENDING',
      mlDecisionSummary: {
        eligibility: 'ML_ELIGIBLE',
        outcome: 'EXECUTED',
        fallback: 'NONE',
        modelVersion: 'model-v1',
      },
      claimsMlAuthority: true,
    },
  });
}

export function buildMlFailedSafePreservesGovernanceInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    intelligence: {
      maturity: 'MATURE',
      readiness: 'READY',
      governanceConvergenceState: 'MISSING',
      governanceContextAvailable: false,
      confidenceStatus: 'HIGH',
      pricingEvidenceAvailable: true,
      telemetryEvidenceAvailable: true,
    },
    policy: {
      actionPolicyApproval: 'REQUIRED',
      actionPolicyExecutionEligibility: 'NOT_ELIGIBLE',
      actionPolicyReadiness: 'READY',
      approvalRequired: true,
      approvalStatus: 'PENDING',
      mlDecisionSummary: {
        eligibility: 'ML_INELIGIBLE',
        outcome: 'FAILED_SAFE',
        fallback: 'DETERMINISTIC_RULES',
      },
      claimsMlAuthority: false,
    },
  });
}

export function buildCrossTenantDecisionDeniedInput(): GovernanceSafetyQualificationInput {
  return baseInput({
    scope: {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      scopeVerified: false,
    },
  });
}
