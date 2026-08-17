import { EVIDENCE_MATURITY_MODEL_VERSION } from './model-version';

/** Approved policy thresholds for evidence-maturity-v1 — versioned, not universal truths. */
export const EVIDENCE_MATURITY_V1_CONFIG = {
  modelVersion: EVIDENCE_MATURITY_MODEL_VERSION,
  matureMinObservationCount: 3,
  matureMinStableEpochHours: 24,
  partialMinObservationCount: 2,
} as const;

export type EvidenceMaturityConfig = typeof EVIDENCE_MATURITY_V1_CONFIG;

export const DEFAULT_EVIDENCE_MATURITY_CONFIG: EvidenceMaturityConfig = EVIDENCE_MATURITY_V1_CONFIG;
