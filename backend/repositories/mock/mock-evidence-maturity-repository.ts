import { randomUUID } from 'node:crypto';

import { cloudResourceAccountPartitionKey } from '../../database';
import { evidenceMaturityAssessmentSortKey } from '../../database/cloud-resources/evidence-maturity-keys';
import { normalizeObservationTimestampIso } from '../../persistence-intelligence/timestamp-rules';
import type {
  EvidenceMaturityAssessment,
  EvidenceMaturityAssessmentRecord,
  RecordEvidenceMaturityAssessmentResult,
} from '../../evidence-maturity/types';
import type {
  EvidenceMaturityAssessmentListQuery,
  EvidenceMaturityRepository,
  GetEvidenceMaturityAssessmentInput,
} from '../contracts/evidence-maturity-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  decodeEvidenceMaturityNextToken,
  encodeEvidenceMaturityNextToken,
} from '../evidence-maturity-pagination';

function logicalKey(input: GetEvidenceMaturityAssessmentInput): string {
  return [
    input.tenantId,
    input.accountId,
    input.findingKey,
    input.sourceLogicalObservationId,
    input.modelVersion,
  ].join('#');
}

function findingIndexKey(tenantId: string, accountId: string, findingKey: string): string {
  return `${tenantId}#${accountId}#${findingKey}`;
}

function sortKeyForRecord(record: EvidenceMaturityAssessmentRecord): string {
  return evidenceMaturityAssessmentSortKey({
    findingKey: record.findingKey,
    sourceObservationTimestampIso: normalizeObservationTimestampIso(
      record.sourceObservationTimestamp,
    ),
    sourceLogicalObservationId: record.sourceLogicalObservationId,
    modelVersion: record.modelVersion,
  });
}

function compareAssessmentsChronologically(
  left: EvidenceMaturityAssessmentRecord,
  right: EvidenceMaturityAssessmentRecord,
): number {
  const leftIso = normalizeObservationTimestampIso(left.sourceObservationTimestamp);
  const rightIso = normalizeObservationTimestampIso(right.sourceObservationTimestamp);
  if (leftIso !== rightIso) {
    return leftIso.localeCompare(rightIso);
  }
  return sortKeyForRecord(left).localeCompare(sortKeyForRecord(right));
}

export class MockEvidenceMaturityRepository implements EvidenceMaturityRepository {
  private readonly byLogicalKey = new Map<string, EvidenceMaturityAssessmentRecord>();
  private readonly byFinding = new Map<string, EvidenceMaturityAssessmentRecord[]>();

  async getAssessmentByLogicalKey(
    input: GetEvidenceMaturityAssessmentInput,
  ): Promise<EvidenceMaturityAssessmentRecord | null> {
    const record = this.byLogicalKey.get(logicalKey(input));
    if (!record || record.tenantId !== input.tenantId) {
      return null;
    }
    return record;
  }

  async listAssessmentsForFinding(
    query: EvidenceMaturityAssessmentListQuery,
  ): Promise<PageResult<EvidenceMaturityAssessmentRecord>> {
    const all = [...(this.byFinding.get(findingIndexKey(query.tenantId, query.accountId, query.findingKey)) ?? [])]
      .filter((record) => record.tenantId === query.tenantId)
      .sort(compareAssessmentsChronologically);

    const startKey = decodeEvidenceMaturityNextToken(query.nextToken, query);
    let startIndex = 0;
    if (startKey?.sk) {
      const marker = String(startKey.sk);
      const markerIndex = all.findIndex((record) => sortKeyForRecord(record) === marker);
      startIndex = markerIndex >= 0 ? markerIndex + 1 : 0;
    }

    const limit = normalizePageSize(query.limit);
    const page = all.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < all.length;
    const lastRecord = page[page.length - 1];
    const nextToken =
      hasMore && lastRecord
        ? encodeEvidenceMaturityNextToken(query, {
            pk: cloudResourceAccountPartitionKey(query.tenantId, query.accountId),
            sk: sortKeyForRecord(lastRecord),
          })
        : undefined;

    return { items: page, nextToken };
  }

  async recordAssessment(
    assessment: EvidenceMaturityAssessment,
  ): Promise<RecordEvidenceMaturityAssessmentResult> {
    const key = logicalKey({
      tenantId: assessment.tenantId,
      accountId: assessment.accountId,
      findingKey: assessment.findingKey,
      sourceLogicalObservationId: assessment.sourceLogicalObservationId,
      modelVersion: assessment.modelVersion,
    });
    const existing = this.byLogicalKey.get(key);
    if (existing) {
      return { record: existing, created: false };
    }

    const persistedAt = new Date().toISOString();
    const record: EvidenceMaturityAssessmentRecord = {
      ...assessment,
      assessmentId: randomUUID(),
      persistedAt,
    };
    this.byLogicalKey.set(key, record);
    const indexKey = findingIndexKey(assessment.tenantId, assessment.accountId, assessment.findingKey);
    const list = this.byFinding.get(indexKey) ?? [];
    list.push(record);
    this.byFinding.set(indexKey, list);
    return { record, created: true };
  }
}
