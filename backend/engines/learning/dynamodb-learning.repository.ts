/**
 * DynamoDB-backed LearningRepository.
 */

import type {
  LearningRecord,
  RecommendationDecision,
  VerificationReport,
} from '../../shared/types';
import {
  buildTenantPartitionKey,
  type PersistenceTable,
} from '../../persistence/persistence-table';
import {
  ownershipPartitionKey,
  OWNERSHIP_SORT_KEY,
} from '../../database/dynamodb-keys';
import {
  buildAppendOnlyKeySuffix,
  compareAppendOnlySortKeys,
} from '../../persistence/append-only-key';
import {
  ensureEngineOwnership,
  resolveEngineOwnershipTenantId,
} from '../../persistence/engine-ownership';
import { computeExpiresAt, LEARNING_RETENTION_SECONDS } from '../../persistence/retention';
import {
  toLearningMetadata,
  type ConfidenceHistoryEntry,
  type LearningFeedback,
  type LearningMetadata,
  type LearningRepository,
} from './learning.repository';

function learnSk(workflowId: string): string {
  return `LEARN#${workflowId}`;
}

function feedbackPrefix(workflowId?: string): string {
  return workflowId ? `LEARNFB#${workflowId}#` : 'LEARNFB#';
}

function feedbackSk(workflowId: string, feedbackId: string): string {
  return `LEARNFB#${workflowId}#${feedbackId}`;
}

function confidencePrefix(workflowId?: string): string {
  return workflowId ? `LEARNCONF#${workflowId}#` : 'LEARNCONF#';
}

function byRecordedAtAscending(
  left: { recordedAt: string },
  right: { recordedAt: string }
): number {
  return (
    new Date(left.recordedAt).getTime() -
    new Date(right.recordedAt).getTime()
  );
}

export class DynamoDbLearningRepository implements LearningRepository {
  constructor(
    private readonly table: PersistenceTable,
    private readonly ownershipTable: PersistenceTable
  ) {}

  async save(record: LearningRecord): Promise<LearningRecord> {
    const pk = buildTenantPartitionKey(record.tenantId);
    const expiresAt = computeExpiresAt(LEARNING_RETENTION_SECONDS);

    await this.table.putItem({
      pk,
      sk: learnSk(record.workflowId),
      entityType: 'learning-record',
      recordedAt: record.recordedAt,
      expiresAt,
      data: record,
    });

    await ensureEngineOwnership(this.ownershipTable, {
      pk: ownershipPartitionKey('WORKFLOW', record.workflowId),
      entityType: 'workflow-owner-index',
      ownerTenantId: record.tenantId,
      expiresAt,
    });

    return record;
  }

  async findByWorkflowId(
    tenantId: string,
    workflowId: string
  ): Promise<LearningRecord | undefined> {
    const item = await this.table.getItem(
      buildTenantPartitionKey(tenantId),
      learnSk(workflowId)
    );

    return item?.data as LearningRecord | undefined;
  }

  async listPage(
    tenantId: string,
    options: { limit?: number; nextToken?: string } = {}
  ): Promise<{ records: LearningRecord[]; nextToken?: string }> {
    const page = await this.table.queryPageByPrefix({
      pk: buildTenantPartitionKey(tenantId),
      skPrefix: 'LEARN#',
      limit: options.limit,
      nextToken: options.nextToken,
      scanIndexForward: false,
      paginationContext: {
        tenantId,
        scope: 'learning:list',
      },
    });

    const records = page.items
      .map((item) => item.data as LearningRecord)
      .sort(
        (left, right) =>
          new Date(right.recordedAt).getTime() -
          new Date(left.recordedAt).getTime()
      );

    return { records, nextToken: page.nextToken };
  }

  async list(tenantId: string): Promise<LearningRecord[]> {
    const page = await this.listPage(tenantId, { limit: 100 });
    return page.records;
  }

  async listMetadata(tenantId: string): Promise<LearningMetadata[]> {
    return (await this.list(tenantId)).map(toLearningMetadata);
  }

  async listRecommendations(
    tenantId: string
  ): Promise<RecommendationDecision[]> {
    return (await this.list(tenantId)).map(
      (record) => record.recommendation
    );
  }

  async listReports(tenantId: string): Promise<VerificationReport[]> {
    return (await this.list(tenantId)).map((record) => ({
      tenantId: record.tenantId,
      workflowId: record.workflowId,
      executionId: record.execution.executionId,
      status: record.verification.status,
      expected: {
        expectedMonthlySavings:
          record.outcome.financialImpact.monthlySavings,
        expectedInstanceType:
          record.recommendation.detail.toInstanceType,
        previousInstanceType:
          record.recommendation.detail.fromInstanceType,
        currency: record.outcome.financialImpact.currency,
      },
      observation: record.observation,
      result: record.verification,
      generatedAt: record.recordedAt,
      summary: `${record.verification.status.toUpperCase()}: ${
        record.verification.message ?? 'Verification complete'
      }`,
    }));
  }

  async addFeedback(
    feedback: LearningFeedback
  ): Promise<LearningFeedback> {
    await this.requireRecord(feedback.tenantId, feedback.workflowId);

    await this.table.putItem({
      pk: buildTenantPartitionKey(feedback.tenantId),
      sk: feedbackSk(feedback.workflowId, feedback.feedbackId),
      entityType: 'learning-feedback',
      recordedAt: feedback.recordedAt,
      expiresAt: computeExpiresAt(LEARNING_RETENTION_SECONDS),
      data: feedback,
    });

    return feedback;
  }

  async listFeedback(
    tenantId: string,
    workflowId?: string
  ): Promise<LearningFeedback[]> {
    const items = await this.table.queryByPrefix(
      buildTenantPartitionKey(tenantId),
      feedbackPrefix(workflowId)
    );

    return items
      .map((item) => item.data as LearningFeedback)
      .sort(byRecordedAtAscending);
  }

  async appendConfidence(
    entry: ConfidenceHistoryEntry
  ): Promise<ConfidenceHistoryEntry> {
    await this.requireRecord(entry.tenantId, entry.workflowId);

    const pk = buildTenantPartitionKey(entry.tenantId);
    const sk = `${confidencePrefix(entry.workflowId)}${buildAppendOnlyKeySuffix(entry.recordedAt)}`;

    await this.table.putItem({
      pk,
      sk,
      entityType: 'learning-confidence',
      recordedAt: entry.recordedAt,
      expiresAt: computeExpiresAt(LEARNING_RETENTION_SECONDS),
      data: entry,
    });

    return entry;
  }

  async listConfidenceHistory(
    tenantId: string,
    workflowId?: string
  ): Promise<ConfidenceHistoryEntry[]> {
    const items = await this.table.queryByPrefix(
      buildTenantPartitionKey(tenantId),
      confidencePrefix(workflowId)
    );

    return items
      .sort((left, right) =>
        compareAppendOnlySortKeys(left.sk as string, right.sk as string)
      )
      .map((item) => item.data as ConfidenceHistoryEntry)
      .sort(byRecordedAtAscending);
  }

  async resolveOwnerTenantId(
    workflowId: string
  ): Promise<string | undefined> {
    const item = await this.ownershipTable.getItem(
      ownershipPartitionKey('WORKFLOW', workflowId),
      OWNERSHIP_SORT_KEY
    );
    return resolveEngineOwnershipTenantId(item);
  }

  private async requireRecord(
    tenantId: string,
    workflowId: string
  ): Promise<void> {
    const record = await this.findByWorkflowId(tenantId, workflowId);

    if (!record) {
      throw new Error(
        `Learning record not found for workflow ${workflowId}`
      );
    }
  }
}
