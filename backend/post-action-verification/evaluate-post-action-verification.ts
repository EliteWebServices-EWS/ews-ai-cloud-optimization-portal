import { VERIFICATION_STATUS } from '../shared/constants';
import { PostActionVerificationScopeError } from './errors';
import { POST_ACTION_VERIFICATION_POLICY_VERSION } from './model-version';
import {
  POST_ACTION_VERIFICATION_REASON,
  type PostActionVerificationReasonCode,
} from './reason-codes';
import type {
  EvaluatePostActionVerificationInput,
  PostActionVerificationAssessment,
  PostActionVerificationOutcome,
} from './types';

function assertTrustedScope(input: EvaluatePostActionVerificationInput): void {
  if (!input.tenantId || !input.accountId) {
    throw new PostActionVerificationScopeError(
      'Post-action verification requires explicit tenantId and accountId',
    );
  }
  if (
    input.evidenceContextScope.tenantId !== input.tenantId ||
    input.evidenceContextScope.accountId !== input.accountId
  ) {
    throw new PostActionVerificationScopeError(
      'Post-action evidence context scope does not match verification tenant/account',
    );
  }
}

function buildAssessment(
  input: EvaluatePostActionVerificationInput,
  outcome: PostActionVerificationOutcome,
  reasonCodes: readonly PostActionVerificationReasonCode[],
): PostActionVerificationAssessment {
  return {
    outcome,
    reasonCodes,
    evaluatedAt: input.evaluatedAt,
    verificationPolicyVersion: POST_ACTION_VERIFICATION_POLICY_VERSION,
    assessmentId: input.assessmentId,
    executionReference: input.executionReference,
    beforeEvidenceReference: input.beforeEvidenceReference,
    afterEvidenceReference: input.afterEvidenceReference,
    recommendationStateReference: input.recommendationStateReference,
    telemetryEvidenceReference: input.telemetryEvidenceReference,
    expectedImpactReference: input.expectedImpactReference,
    observedImpactReference: input.observedImpactReference,
    legacyVerificationStatus: input.comparatorResult.status,
    comparatorResult: input.comparatorResult,
  };
}

function legacyReasonCode(
  status: EvaluatePostActionVerificationInput['comparatorResult']['status'],
): PostActionVerificationReasonCode {
  switch (status) {
    case VERIFICATION_STATUS.VERIFIED:
      return POST_ACTION_VERIFICATION_REASON.LEGACY_VERIFIED;
    case VERIFICATION_STATUS.PARTIAL:
      return POST_ACTION_VERIFICATION_REASON.LEGACY_PARTIAL;
    case VERIFICATION_STATUS.FAILED:
      return POST_ACTION_VERIFICATION_REASON.LEGACY_FAILED;
    default:
      return POST_ACTION_VERIFICATION_REASON.LEGACY_PENDING;
  }
}

/**
 * Sprint 3 enterprise outcome layer. Does not replace legacy comparator semantics.
 * API success (executionCompleted) alone never yields RESOLVED.
 */
export function evaluatePostActionVerification(
  input: EvaluatePostActionVerificationInput,
): PostActionVerificationAssessment {
  assertTrustedScope(input);

  const reasons: PostActionVerificationReasonCode[] = [
    legacyReasonCode(input.comparatorResult.status),
  ];

  if (!input.executionCompleted) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.EXECUTION_NOT_COMPLETED);
    return buildAssessment(
      input,
      'INSUFFICIENT_EVIDENCE',
      [...reasons, POST_ACTION_VERIFICATION_REASON.INSUFFICIENT_EVIDENCE],
    );
  }

  if (input.afterEvidenceReference === null) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.INSUFFICIENT_EVIDENCE);
    return buildAssessment(input, 'INSUFFICIENT_EVIDENCE', reasons);
  }

  if (input.telemetry.available === null || input.telemetry.available === false) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.TELEMETRY_MISSING);
    return buildAssessment(input, 'INSUFFICIENT_EVIDENCE', reasons);
  }

  if (
    input.telemetry.qualityAdequate === null ||
    input.telemetry.qualityAdequate === false
  ) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.TELEMETRY_INADEQUATE);
    return buildAssessment(input, 'INSUFFICIENT_EVIDENCE', reasons);
  }

  if (!input.recommendationState.sufficientEvidence) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.RECOMMENDATION_STATE_UNKNOWN);
    if (input.telemetry.degraded === true) {
      reasons.push(POST_ACTION_VERIFICATION_REASON.TELEMETRY_DEGRADED);
      return buildAssessment(input, 'DEGRADED', reasons);
    }
    return buildAssessment(input, 'INSUFFICIENT_EVIDENCE', reasons);
  }

  if (input.recommendationState.present === null) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.RECOMMENDATION_STATE_UNKNOWN);
    return buildAssessment(input, 'INSUFFICIENT_EVIDENCE', reasons);
  }

  const measurableDegradation =
    input.telemetry.degraded === true ||
    input.comparatorResult.status === VERIFICATION_STATUS.FAILED ||
    (!input.comparatorResult.stateMatched &&
      input.comparatorResult.status !== VERIFICATION_STATUS.VERIFIED);

  if (measurableDegradation) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.MEASURABLE_DEGRADATION);
    if (input.telemetry.degraded === true) {
      reasons.push(POST_ACTION_VERIFICATION_REASON.TELEMETRY_DEGRADED);
    }
    if (!input.comparatorResult.stateMatched) {
      reasons.push(POST_ACTION_VERIFICATION_REASON.STATE_MISMATCH);
    }
    if (
      input.comparatorResult.status === VERIFICATION_STATUS.PARTIAL ||
      input.comparatorResult.status === VERIFICATION_STATUS.FAILED
    ) {
      reasons.push(POST_ACTION_VERIFICATION_REASON.SAVINGS_BELOW_THRESHOLD);
    }

    const rollbackCandidate =
      input.telemetry.degraded === true &&
      input.comparatorResult.stateMatched === false &&
      input.comparatorResult.status !== VERIFICATION_STATUS.VERIFIED;

    if (rollbackCandidate) {
      reasons.push(POST_ACTION_VERIFICATION_REASON.ROLLBACK_CANDIDATE_ADVISORY);
      return buildAssessment(input, 'ROLLBACK_CANDIDATE', reasons);
    }

    return buildAssessment(input, 'DEGRADED', reasons);
  }

  if (input.recommendationState.present === true) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.RECOMMENDATION_PERSISTS);
    reasons.push(POST_ACTION_VERIFICATION_REASON.HEALTHY_POST_ACTION);
    return buildAssessment(input, 'HEALTHY', reasons);
  }

  if (
    input.comparatorResult.status === VERIFICATION_STATUS.VERIFIED &&
    input.comparatorResult.stateMatched
  ) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.RECOMMENDATION_RESOLVED);
    return buildAssessment(input, 'RESOLVED', reasons);
  }

  if (!input.comparatorResult.stateMatched) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.STATE_MISMATCH);
  }
  if (input.comparatorResult.status !== VERIFICATION_STATUS.VERIFIED) {
    reasons.push(POST_ACTION_VERIFICATION_REASON.SAVINGS_BELOW_THRESHOLD);
  }

  return buildAssessment(input, 'DEGRADED', reasons);
}

export function mapLegacyStatusToOutcome(
  status: EvaluatePostActionVerificationInput['comparatorResult']['status'],
): PostActionVerificationOutcome | null {
  switch (status) {
    case VERIFICATION_STATUS.VERIFIED:
      return 'HEALTHY';
    case VERIFICATION_STATUS.PARTIAL:
      return 'DEGRADED';
    case VERIFICATION_STATUS.FAILED:
      return 'DEGRADED';
    case VERIFICATION_STATUS.PENDING:
      return 'INSUFFICIENT_EVIDENCE';
    default:
      return null;
  }
}
