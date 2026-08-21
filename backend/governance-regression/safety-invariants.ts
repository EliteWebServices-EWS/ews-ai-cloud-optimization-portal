import type { GovernanceSafetyIntelligenceSlice } from './types';

export function isGovernanceFailed(
  intelligence: GovernanceSafetyIntelligenceSlice,
): boolean {
  if (intelligence.governanceContextAvailable === false) {
    return true;
  }
  if (intelligence.governanceConvergenceState === 'MISSING') {
    return true;
  }
  if (intelligence.legacyGovernancePolicyStatus === 'FAIL') {
    return true;
  }
  return false;
}

export function isImmatureWithReady(
  intelligence: GovernanceSafetyIntelligenceSlice,
): boolean {
  return (
    intelligence.maturity === 'IMMATURE' && intelligence.readiness === 'READY'
  );
}

export function isNotReadyWithExecutionEligible(input: {
  intelligence: GovernanceSafetyIntelligenceSlice;
  executionEligibility?: 'ELIGIBLE' | 'NOT_ELIGIBLE' | null;
}): boolean {
  return (
    input.intelligence.readiness === 'NOT_READY' &&
    input.executionEligibility === 'ELIGIBLE'
  );
}

export function isGovernanceFailWithExecutionEligible(input: {
  intelligence: GovernanceSafetyIntelligenceSlice;
  executionEligibility?: 'ELIGIBLE' | 'NOT_ELIGIBLE' | null;
}): boolean {
  return isGovernanceFailed(input.intelligence) && input.executionEligibility === 'ELIGIBLE';
}

export function isMissingTelemetryForQualification(
  intelligence: GovernanceSafetyIntelligenceSlice,
): boolean {
  return intelligence.telemetryEvidenceAvailable === false;
}

export function isMissingPricingForQualification(
  intelligence: GovernanceSafetyIntelligenceSlice,
): boolean {
  return intelligence.pricingEvidenceAvailable === false;
}

export function isMissingVerificationEvidence(
  verificationEvidenceSufficient?: boolean | null,
): boolean {
  return verificationEvidenceSufficient === false;
}
