import type { GovernanceConvergenceReasonCode } from './reason-codes';

/**
 * Frozen Sprint 2 contract (Task 1). Exactly these four values — no
 * additional free-form classification is permitted. See
 * docs/architecture/sprint-2-governance-convergence.md for the decision
 * table and the engineering rationale for each transition.
 */
export const GOVERNANCE_CONVERGENCE_STATES = [
  'PRESERVED',
  'IMPROVED',
  'REPLACED',
  'MISSING',
] as const;

export type GovernanceConvergenceState = (typeof GOVERNANCE_CONVERGENCE_STATES)[number];

/**
 * Canonical output contract (Task 1). Field names and the `state` union are
 * frozen; do not widen `state` or add a free-form variant.
 */
export interface GovernanceConvergenceAssessment {
  state: GovernanceConvergenceState;
  reasonCodes: GovernanceConvergenceReasonCode[];
  previousEvidenceId?: string;
  currentEvidenceId?: string;
  evaluatedAt: string;
  ruleVersion: string;
}

/**
 * A single control's governance posture at one point in evidence-collection
 * time, derived from an existing EC2 security/governance finding (Task 3).
 * `undefined` (not `false`) represents "this control was not evaluated" —
 * absence of evidence must never be read as compliance.
 */
export interface GovernanceEvidenceSnapshot {
  /** True = control satisfied (no active violation). Undefined = not evaluated. */
  satisfied?: boolean;
  /** Existing EC2 security/governance check identifier, e.g. 'unrestricted_ssh'. */
  check: string;
  category: 'security' | 'governance';
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** Content fingerprint of the finding's substantive fields (see governance-evidence-fingerprint.ts). */
  fingerprint: string;
  /** Rule/analyzer version that produced this snapshot. */
  ruleVersion: string;
  /** Underlying finding identity this snapshot was derived from, if any. */
  sourceFindingId?: string;
}

/**
 * Pure, append-only evidence log — one row per analysis run per
 * (resource, check) whenever evidence was actually produced. This is
 * Task 3's "existing findings become usable as longitudinal governance
 * evidence"; it carries no classification. The classification output lives
 * separately in GovernanceConvergenceResultRecord (Task 4), because a
 * missing-evidence run produces a result without ever producing a new
 * observation row (there is no honest evidence to log).
 */
export interface GovernanceEvidenceObservationRecord {
  observationId: string;
  logicalObservationId: string;
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: 'INSTANCE';
  resourceId: string;
  check: string;
  findingKey: string;
  analysisRunId: string;
  observationTimestamp: string;
  collectionTimestamp: string;
  persistedAt: string;
  evidence: GovernanceEvidenceSnapshot;
  version: number;
}

export interface RecordGovernanceEvidenceObservationInput {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  check: string;
  findingKey: string;
  analysisRunId: string;
  observationTimestamp: string;
  collectionTimestamp: string;
  evidence: GovernanceEvidenceSnapshot;
}

export interface RecordGovernanceEvidenceObservationResult {
  observation: GovernanceEvidenceObservationRecord;
  /** Present only when a comparable prior observation existed to converge against. */
  result?: GovernanceConvergenceResultRecord;
  created: boolean;
}

/**
 * Task 4's primary persistence deliverable: the durable convergence
 * classification, with enough provenance to answer "what governance
 * evidence was compared to reach this conclusion".
 */
/**
 * Mutable latest-state checkpoint for one (tenant, account, region, resource, check).
 * Separate from append-only GOVERNANCE_CONVERGENCE_OBSERVATION rows.
 */
export interface GovernanceLatestObservedControlRecord {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  check: string;
  findingKey: string;
  latestObservationId: string;
  latestLogicalObservationId: string;
  latestObservationTimestamp: string;
  latestAnalysisRunId: string;
  latestRuleVersion: string;
  resourceLifecycleStatus?: 'ACTIVE' | 'NOT_SEEN' | 'STALE';
  updatedAt: string;
  version: number;
}

export interface UpsertGovernanceLatestObservedControlInput {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  check: string;
  findingKey: string;
  latestObservationId: string;
  latestLogicalObservationId: string;
  latestObservationTimestamp: string;
  latestAnalysisRunId: string;
  latestRuleVersion: string;
  resourceLifecycleStatus?: 'ACTIVE' | 'NOT_SEEN' | 'STALE';
}

export interface GovernanceConvergenceResultRecord extends GovernanceConvergenceAssessment {
  resultId: string;
  /** Deterministic logical observation identity for observation-backed results. */
  currentLogicalObservationId?: string;
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: 'INSTANCE';
  resourceId: string;
  check: string;
  findingKey: string;
  analysisRunId: string;
  persistedAt: string;
  version: number;
}
