/** Auditable evidence maturity model identifier — not derived from git, date, or environment. */
export const EVIDENCE_MATURITY_MODEL_VERSION = 'evidence-maturity-v1' as const;

export type EvidenceMaturityModelVersion = typeof EVIDENCE_MATURITY_MODEL_VERSION;
