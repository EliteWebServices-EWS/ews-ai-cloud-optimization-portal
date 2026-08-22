import type { MLDecision, MlOutcome } from '../ml-decision/types';
import type { MlProductionQualificationReasonCode } from './reason-codes';

export const ML_PRODUCTION_QUALIFICATION_RESULTS = [
  'PRODUCTION_QUALIFIED',
  'NOT_QUALIFIED',
  'DEFERRED',
] as const;

export type MlProductionQualificationStatus =
  (typeof ML_PRODUCTION_QUALIFICATION_RESULTS)[number];

/**
 * Test/read snapshot over already-produced Sprint 3 ML decisions.
 * Does not invoke inference and must not make runtime business decisions.
 */
export interface MlProductionQualificationSnapshot {
  evaluatedAt: string;
  decisions: readonly MLDecision[];
  /** Live SageMaker / vendor provider remains DEFERRED until an approved adapter exists. */
  liveExternalProviderIntegrated: boolean;
  /** Release-blocking claim that ML set READY / APPROVED / execution eligibility. */
  claimsMlAuthority?: boolean;
}

export interface MlProductionQualificationResult {
  result: MlProductionQualificationStatus;
  reasonCodes: readonly MlProductionQualificationReasonCode[];
  evaluatedAt: string;
  observedOutcomes: readonly MlOutcome[];
}
