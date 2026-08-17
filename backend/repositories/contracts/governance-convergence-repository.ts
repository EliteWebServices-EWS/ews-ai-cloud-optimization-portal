import type { PageResult } from './repository-types';
import type {
  GovernanceConvergenceResultRecord,
  GovernanceEvidenceObservationRecord,
  GovernanceLatestObservedControlRecord,
  RecordGovernanceEvidenceObservationInput,
  RecordGovernanceEvidenceObservationResult,
  UpsertGovernanceLatestObservedControlInput,
} from '../../governance-convergence/types';

export interface GovernanceConvergenceListQuery {
  tenantId: string;
  accountId: string;
  findingKey: string;
  limit?: number;
  nextToken?: string;
}

export interface ListLatestObservedControlsQuery {
  tenantId: string;
  accountId: string;
  regions: readonly string[];
  limit?: number;
  nextToken?: string;
}

export interface GetGovernanceConvergenceObservationByLogicalIdInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  analysisRunId: string;
  observationTimestamp: string;
}

export interface FindRelevantPreviousGovernanceObservationInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  beforeObservationTimestamp: string;
  excludeLogicalObservationId?: string;
}

export interface RecordGovernanceMissingEvidenceInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  analysisRunId: string;
  evaluatedAt: string;
}

/**
 * Mirrors EvidenceObservationRepository's shape (Engineer 1's Sprint 1
 * contract) for a governance-specific, append-only observation log, plus a
 * separate durable result log for Task 4's persisted classifications.
 * Every read is tenant-scoped; implementations must never return a record
 * belonging to a different tenant even given a valid findingKey for it.
 */
export interface GovernanceConvergenceRepository {
  /**
   * Records a new evidence observation and, when a comparable prior
   * observation exists, classifies and persists the convergence result in
   * the same call. Idempotent on the logical observation identity
   * (tenantId, accountId, findingKey, analysisRunId, observationTimestamp).
   */
  recordObservation(
    input: RecordGovernanceEvidenceObservationInput,
  ): Promise<RecordGovernanceEvidenceObservationResult>;

  /**
   * Records a MISSING result for a control that had prior evidence but
   * produced none this run. No-op (returns null) when no prior observation
   * exists — there is nothing to report as missing.
   */
  recordMissingEvidence(
    input: RecordGovernanceMissingEvidenceInput,
  ): Promise<GovernanceConvergenceResultRecord | null>;

  getObservationByLogicalId(
    input: GetGovernanceConvergenceObservationByLogicalIdInput,
  ): Promise<GovernanceEvidenceObservationRecord | null>;
  findRelevantPreviousObservation(
    input: FindRelevantPreviousGovernanceObservationInput,
  ): Promise<GovernanceEvidenceObservationRecord | null>;
  listObservationsForFinding(
    query: GovernanceConvergenceListQuery,
  ): Promise<PageResult<GovernanceEvidenceObservationRecord>>;

  getLatestResult(
    tenantId: string,
    accountId: string,
    findingKey: string,
  ): Promise<GovernanceConvergenceResultRecord | null>;
  listResultsForFinding(
    query: GovernanceConvergenceListQuery,
  ): Promise<PageResult<GovernanceConvergenceResultRecord>>;

  /**
   * Upserts the bounded latest-state checkpoint after a successful observation
   * persist. Never mutates historical observation/result rows. Out-of-order
   * writes must not replace a newer checkpoint.
   */
  upsertLatestObservedControl(
    input: UpsertGovernanceLatestObservedControlInput,
  ): Promise<GovernanceLatestObservedControlRecord>;

  /**
   * Paginated latest-state registry for authoritative region scope only.
   * No Scan and no historical observation enumeration.
   */
  listLatestObservedControls(
    query: ListLatestObservedControlsQuery,
  ): Promise<PageResult<GovernanceLatestObservedControlRecord>>;

  /** Ownership-only lookup for tenant-isolation audit paths; never exposes the record itself. */
  resolveOwnerTenantId(findingKey: string): Promise<string | undefined>;
}
