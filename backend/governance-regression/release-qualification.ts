import { detectGovernanceContradictions } from './contradiction-detector';
import { GOVERNANCE_SAFETY_REASON, type GovernanceSafetyReasonCode } from './reason-codes';
import {
  isMissingPricingForQualification,
  isMissingTelemetryForQualification,
  isMissingVerificationEvidence,
} from './safety-invariants';
import type {
  GovernanceSafetyQualificationInput,
  GovernanceSafetyQualificationResult,
} from './types';

function uniqueReasons(
  codes: readonly GovernanceSafetyReasonCode[],
): GovernanceSafetyReasonCode[] {
  return [...new Set(codes)];
}

export function qualifyGovernanceSafety(
  input: GovernanceSafetyQualificationInput,
): GovernanceSafetyQualificationResult {
  const contradictions = detectGovernanceContradictions(input);

  if (!input.scope.scopeVerified) {
    return {
      result: 'BLOCKED',
      reasonCodes: uniqueReasons([
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CROSS_TENANT_DENIED,
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CONTRADICTION_DETECTED,
      ]),
      contradictions,
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (contradictions.length > 0) {
    const reasonCodes = uniqueReasons([
      GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CONTRADICTION_DETECTED,
    ]);

    if (input.policy.mlDecisionSummary?.outcome === 'EXECUTED') {
      reasonCodes.push(GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_ML_HIGH_NON_AUTHORITY);
    }

    if (input.policy.mlDecisionSummary?.outcome === 'FAILED_SAFE') {
      reasonCodes.push(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_ML_FAILED_SAFE_PRESERVES_GOVERNANCE,
      );
    }

    return {
      result: 'BLOCKED',
      reasonCodes: uniqueReasons(reasonCodes),
      contradictions,
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (isMissingTelemetryForQualification(input.intelligence)) {
    return {
      result: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: [GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_TELEMETRY],
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (isMissingPricingForQualification(input.intelligence)) {
    return {
      result: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: [GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_PRICING],
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (
    isMissingVerificationEvidence(input.verification?.verificationEvidenceSufficient)
  ) {
    return {
      result: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: [
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_VERIFICATION_EVIDENCE,
      ],
      evaluatedAt: input.evaluatedAt,
    };
  }

  if (
    input.intelligence.governanceContextAvailable == null ||
    input.intelligence.confidenceStatus == null
  ) {
    return {
      result: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: [
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_INTELLIGENCE_CONTEXT,
      ],
      evaluatedAt: input.evaluatedAt,
    };
  }

  return {
    result: 'SAFE',
    reasonCodes: [GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_SAFE],
    evaluatedAt: input.evaluatedAt,
  };
}
