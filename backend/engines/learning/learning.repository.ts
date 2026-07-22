/**
 * Persistence boundary for closed-loop learning data.
 *
 * Every read is explicitly tenant scoped so a durable implementation can use
 * tenant-partitioned keys without exposing records across organizations.
 */
import type {
  ConfidenceResult,
  LearningRecord,
  RecommendationDecision,
  VerificationReport,
} from '../../shared/types';

export type LearningMetadata = Pick<
  LearningRecord,
  'id' | 'tenantId' | 'workflowId' | 'plugin' | 'recordedAt'
> & {
  recommendationStatus: LearningRecord['recommendation']['status'];
  verificationStatus: LearningRecord['verification']['status'];
};

/** Human or automated feedback associated with a learning outcome. */
export interface LearningFeedback {
  feedbackId: string;
  tenantId: string;
  workflowId: string;
  recommendationStatus: RecommendationDecision['status'];
  verdict: 'accepted' | 'rejected' | 'neutral';
  comment?: string;
  submittedBy?: string;
  recordedAt: string;
}

/** Immutable confidence snapshot captured for future learning analysis. */
export interface ConfidenceHistoryEntry {
  historyId: string;
  tenantId: string;
  workflowId: string;
  confidence: ConfidenceResult;
  recordedAt: string;
}

export interface LearningRepository {
  save(record: LearningRecord): Promise<LearningRecord>;
  findByWorkflowId(tenantId: string, workflowId: string): Promise<LearningRecord | undefined>;
  list(tenantId: string): Promise<LearningRecord[]>;
  listMetadata(tenantId: string): Promise<LearningMetadata[]>;
  listRecommendations(tenantId: string): Promise<RecommendationDecision[]>;
  listReports(tenantId: string): Promise<VerificationReport[]>;
  addFeedback(feedback: LearningFeedback): Promise<LearningFeedback>;
  listFeedback(tenantId: string, workflowId?: string): Promise<LearningFeedback[]>;
  appendConfidence(entry: ConfidenceHistoryEntry): Promise<ConfidenceHistoryEntry>;
  listConfidenceHistory(tenantId: string, workflowId?: string): Promise<ConfidenceHistoryEntry[]>;
  /**
   * Ownership-index lookup used only for tenant.access_denied auditing.
   * Bypasses tenant scoping; callers must never return the resolved
   * tenant to a client.
   */
  resolveOwnerTenantId(workflowId: string): Promise<string | undefined>;
}

export function toLearningMetadata(record: LearningRecord): LearningMetadata {
  return {
    id: record.id,
    tenantId: record.tenantId,
    workflowId: record.workflowId,
    plugin: record.plugin,
    recordedAt: record.recordedAt,
    recommendationStatus: record.recommendation.status,
    verificationStatus: record.verification.status,
  };
}
