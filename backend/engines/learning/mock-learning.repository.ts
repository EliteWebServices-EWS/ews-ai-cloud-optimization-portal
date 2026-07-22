/** In-memory LearningRepository implementation for development and unit tests. */
import type { LearningRecord, VerificationReport } from '../../shared/types';
import type {
  ConfidenceHistoryEntry,
  LearningFeedback,
  LearningMetadata,
  LearningRepository,
} from './learning.repository';
import { toLearningMetadata } from './learning.repository';

function recordKey(tenantId: string, workflowId: string): string {
  return `${tenantId}:${workflowId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Models the tenant isolation and append-only history expected of a durable
 * learning-store adapter, without coupling business logic to DynamoDB.
 */
export class MockLearningRepository implements LearningRepository {
  private readonly records = new Map<string, LearningRecord>();
  private readonly feedback = new Map<string, LearningFeedback[]>();
  private readonly confidenceHistory = new Map<string, ConfidenceHistoryEntry[]>();
  private readonly ownerIndex = new Map<string, string>();

  async save(record: LearningRecord): Promise<LearningRecord> {
    const stored = clone(record);
    this.records.set(recordKey(stored.tenantId, stored.workflowId), stored);
    this.ownerIndex.set(stored.workflowId, stored.tenantId);
    return clone(stored);
  }

  async resolveOwnerTenantId(workflowId: string): Promise<string | undefined> {
    return this.ownerIndex.get(workflowId);
  }

  async findByWorkflowId(tenantId: string, workflowId: string): Promise<LearningRecord | undefined> {
    const record = this.records.get(recordKey(tenantId, workflowId));
    return record ? clone(record) : undefined;
  }

  async list(tenantId: string): Promise<LearningRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => record.tenantId === tenantId)
      .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())
      .map(clone);
  }

  async listMetadata(tenantId: string): Promise<LearningMetadata[]> {
    return (await this.list(tenantId)).map(toLearningMetadata);
  }

  async listRecommendations(tenantId: string) {
    return (await this.list(tenantId)).map((record) => clone(record.recommendation));
  }

  async listReports(tenantId: string): Promise<VerificationReport[]> {
    return (await this.list(tenantId)).map((record) => ({
      tenantId: record.tenantId,
      workflowId: record.workflowId,
      executionId: record.execution.executionId,
      status: record.verification.status,
      expected: {
        expectedMonthlySavings: record.outcome.financialImpact.monthlySavings,
        expectedInstanceType: record.recommendation.detail.toInstanceType,
        previousInstanceType: record.recommendation.detail.fromInstanceType,
        currency: record.outcome.financialImpact.currency,
      },
      observation: clone(record.observation),
      result: clone(record.verification),
      generatedAt: record.recordedAt,
      summary: `${record.verification.status.toUpperCase()}: ${record.verification.message ?? 'Verification complete'}`,
    }));
  }

  async addFeedback(feedback: LearningFeedback): Promise<LearningFeedback> {
    const key = recordKey(feedback.tenantId, feedback.workflowId);
    if (!this.records.has(key)) {
      throw new Error(`Learning record not found for workflow ${feedback.workflowId}`);
    }
    const entries = this.feedback.get(key) ?? [];
    const stored = clone(feedback);
    entries.push(stored);
    this.feedback.set(key, entries);
    return clone(stored);
  }

  async listFeedback(tenantId: string, workflowId?: string): Promise<LearningFeedback[]> {
    return this.listHistory(this.feedback, tenantId, workflowId);
  }

  async appendConfidence(entry: ConfidenceHistoryEntry): Promise<ConfidenceHistoryEntry> {
    const key = recordKey(entry.tenantId, entry.workflowId);
    if (!this.records.has(key)) {
      throw new Error(`Learning record not found for workflow ${entry.workflowId}`);
    }
    const entries = this.confidenceHistory.get(key) ?? [];
    const stored = clone(entry);
    entries.push(stored);
    this.confidenceHistory.set(key, entries);
    return clone(stored);
  }

  async listConfidenceHistory(tenantId: string, workflowId?: string): Promise<ConfidenceHistoryEntry[]> {
    return this.listHistory(this.confidenceHistory, tenantId, workflowId);
  }

  private listHistory<T extends { tenantId: string; workflowId: string; recordedAt: string }>(
    history: Map<string, T[]>, tenantId: string, workflowId?: string
  ): T[] {
    const entries = workflowId
      ? history.get(recordKey(tenantId, workflowId)) ?? []
      : Array.from(history.entries())
          .filter(([key]) => key.startsWith(`${tenantId}:`))
          .flatMap(([, values]) => values);
    return entries
      .slice()
      .sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime())
      .map(clone);
  }
}
