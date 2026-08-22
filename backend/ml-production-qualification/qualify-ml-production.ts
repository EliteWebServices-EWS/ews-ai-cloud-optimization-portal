import { ML_OUTCOMES } from '../ml-decision/types';
import { ML_PRODUCTION_QUALIFICATION_REASON } from './reason-codes';
import type {
  MlProductionQualificationResult,
  MlProductionQualificationSnapshot,
} from './types';

function uniqueReasons(
  codes: MlProductionQualificationResult['reasonCodes'],
): MlProductionQualificationReasonCode[] {
  return [...new Set(codes)];
}

type MlProductionQualificationReasonCode =
  MlProductionQualificationResult['reasonCodes'][number];

/**
 * Pure qualification/read model over existing MLDecision results.
 * Never a substitute for MlDecisionService.
 */
export function qualifyMlProductionBoundary(
  snapshot: MlProductionQualificationSnapshot,
): MlProductionQualificationResult {
  if (snapshot.liveExternalProviderIntegrated) {
    return {
      result: 'DEFERRED',
      reasonCodes: [ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_DEFERRED_LIVE_PROVIDER],
      evaluatedAt: snapshot.evaluatedAt,
      observedOutcomes: snapshot.decisions.map((decision) => decision.outcome),
    };
  }

  if (snapshot.decisions.length === 0) {
    return {
      result: 'NOT_QUALIFIED',
      reasonCodes: [
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_EMPTY_SNAPSHOT,
      ],
      evaluatedAt: snapshot.evaluatedAt,
      observedOutcomes: [],
    };
  }

  if (snapshot.claimsMlAuthority === true) {
    return {
      result: 'NOT_QUALIFIED',
      reasonCodes: [
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_AUTHORITY_CLAIM,
      ],
      evaluatedAt: snapshot.evaluatedAt,
      observedOutcomes: snapshot.decisions.map((decision) => decision.outcome),
    };
  }

  const reasonCodes: MlProductionQualificationReasonCode[] = [];

  for (const decision of snapshot.decisions) {
    if (!ML_OUTCOMES.includes(decision.outcome)) {
      reasonCodes.push(
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_UNSAFE_OUTCOME,
      );
    }

    if (decision.reasonCodes.length === 0) {
      reasonCodes.push(
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_MISSING_REASON,
      );
    }

    if (decision.outcome === 'EXECUTED' && !decision.validatedOutput) {
      reasonCodes.push(
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_EXECUTED_WITHOUT_OUTPUT,
      );
    }
  }

  if (reasonCodes.length > 0) {
    return {
      result: 'NOT_QUALIFIED',
      reasonCodes: uniqueReasons(reasonCodes),
      evaluatedAt: snapshot.evaluatedAt,
      observedOutcomes: snapshot.decisions.map((decision) => decision.outcome),
    };
  }

  return {
    result: 'PRODUCTION_QUALIFIED',
    reasonCodes: [ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_PRODUCTION_QUALIFIED],
    evaluatedAt: snapshot.evaluatedAt,
    observedOutcomes: snapshot.decisions.map((decision) => decision.outcome),
  };
}
