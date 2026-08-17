import type { PageResult } from './repository-types';
import type {
  EvidenceMaturityAssessment,
  EvidenceMaturityAssessmentRecord,
  RecordEvidenceMaturityAssessmentResult,
} from '../../evidence-maturity/types';

export interface GetEvidenceMaturityAssessmentInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  sourceLogicalObservationId: string;
  modelVersion: string;
  /** When provided, enables direct Get by deterministic sort key on DynamoDB. */
  sourceObservationTimestamp?: string;
}

export interface EvidenceMaturityAssessmentListQuery {
  tenantId: string;
  accountId: string;
  findingKey: string;
  limit?: number;
  nextToken?: string;
}

/**
 * Lists maturity assessments for a finding in deterministic chronological ascending order
 * by normalized `sourceObservationTimestamp` (immutable source evidence observation time).
 */
export interface EvidenceMaturityRepository {
  recordAssessment(assessment: EvidenceMaturityAssessment): Promise<RecordEvidenceMaturityAssessmentResult>;
  getAssessmentByLogicalKey(
    input: GetEvidenceMaturityAssessmentInput,
  ): Promise<EvidenceMaturityAssessmentRecord | null>;
  listAssessmentsForFinding(
    query: EvidenceMaturityAssessmentListQuery,
  ): Promise<PageResult<EvidenceMaturityAssessmentRecord>>;
}
