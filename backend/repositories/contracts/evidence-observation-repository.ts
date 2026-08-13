import type { PageResult } from './repository-types';
import type {
  EvidenceObservationRecord,
  RecordEvidenceObservationInput,
  RecordEvidenceObservationResult,
} from '../../persistence-intelligence/types';

export interface EvidenceObservationListQuery {
  tenantId: string;
  accountId: string;
  findingKey: string;
  limit?: number;
  nextToken?: string;
}

export interface GetEvidenceObservationByLogicalIdInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  analysisRunId: string;
  observationTimestamp: string;
}

export interface FindRelevantPreviousObservationInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  beforeObservationTimestamp: string;
  excludeLogicalObservationId?: string;
}

export interface EvidenceObservationRepository {
  recordObservation(input: RecordEvidenceObservationInput): Promise<RecordEvidenceObservationResult>;
  getObservationByLogicalId(
    input: GetEvidenceObservationByLogicalIdInput,
  ): Promise<EvidenceObservationRecord | null>;
  findRelevantPreviousObservation(
    input: FindRelevantPreviousObservationInput,
  ): Promise<EvidenceObservationRecord | null>;
  listObservationsForFinding(
    query: EvidenceObservationListQuery,
  ): Promise<PageResult<EvidenceObservationRecord>>;
}
