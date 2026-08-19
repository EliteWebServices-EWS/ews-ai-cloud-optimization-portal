import { randomUUID } from 'node:crypto';

import { RepositoryConflictError, cloudResourceAccountPartitionKey } from '../../database';
import {
  evidenceObservationSortKey,
} from '../../database/cloud-resources/evidence-observation-keys';
import {
  assessPersistence,
} from '../../persistence-intelligence/persistence-state-machine';
import {
  buildLogicalObservationId,
  sortObservationsByObservationTimestamp,
} from '../../persistence-intelligence/observation-ordering';
import { normalizeObservationTimestampIso } from '../../persistence-intelligence/timestamp-rules';
import type {
  EvidenceObservationRecord,
  RecordEvidenceObservationInput,
  RecordEvidenceObservationResult,
} from '../../persistence-intelligence/types';
import type {
  EvidenceObservationListQuery,
  EvidenceObservationRepository,
  FindRelevantPreviousObservationInput,
  GetEvidenceObservationByLogicalIdInput,
  GetLatestEvidenceObservationForFindingInput,
} from '../contracts/evidence-observation-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  decodeEvidenceObservationNextToken,
  encodeEvidenceObservationNextToken,
} from '../evidence-observation-pagination';
import { selectLatestRelevantPreviousFromCandidates } from '../evidence-observation-prior-query';

function storageKey(tenantId: string, accountId: string, logicalObservationId: string): string {
  return `${tenantId}#${accountId}#${logicalObservationId}`;
}

function findingIndexKey(tenantId: string, accountId: string, findingKey: string): string {
  return `${tenantId}#${accountId}#${findingKey}`;
}

export class MockEvidenceObservationRepository implements EvidenceObservationRepository {
  private readonly byLogicalId = new Map<string, EvidenceObservationRecord>();
  private readonly byFinding = new Map<string, EvidenceObservationRecord[]>();

  async getObservationByLogicalId(
    input: GetEvidenceObservationByLogicalIdInput,
  ): Promise<EvidenceObservationRecord | null> {
    const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
    const logicalObservationId = buildLogicalObservationId({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
      observationTimestamp: observationTimestampIso,
    });
    const record = this.byLogicalId.get(storageKey(input.tenantId, input.accountId, logicalObservationId));
    return record ?? null;
  }

  async getLatestObservationForFinding(
    input: GetLatestEvidenceObservationForFindingInput,
  ): Promise<EvidenceObservationRecord | null> {
    const all = sortObservationsByObservationTimestamp([
      ...(this.byFinding.get(findingIndexKey(input.tenantId, input.accountId, input.findingKey)) ?? []),
    ]).filter((record) => record.tenantId === input.tenantId);
    return all[all.length - 1] ?? null;
  }

  async listObservationsForFinding(
    query: EvidenceObservationListQuery,
  ): Promise<PageResult<EvidenceObservationRecord>> {
    const all = sortObservationsByObservationTimestamp([
      ...(this.byFinding.get(findingIndexKey(query.tenantId, query.accountId, query.findingKey)) ?? []),
    ]).filter((record) => record.tenantId === query.tenantId);

    const startKey = decodeEvidenceObservationNextToken(query.nextToken, query);
    let startIndex = 0;
    if (startKey?.sk) {
      const marker = String(startKey.sk);
      const markerLogicalId = marker.split('#LOG#').pop();
      const markerIndex = all.findIndex(
        (record) => record.logicalObservationId === markerLogicalId,
      );
      startIndex = markerIndex >= 0 ? markerIndex + 1 : 0;
    }

    const limit = normalizePageSize(query.limit);
    const page = all.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < all.length;
    const lastRecord = page[page.length - 1];
    const nextToken =
      hasMore && lastRecord
        ? encodeEvidenceObservationNextToken(query, {
            pk: cloudResourceAccountPartitionKey(query.tenantId, query.accountId),
            sk: evidenceObservationSortKey({
              findingKey: lastRecord.findingKey,
              observationTimestampIso: lastRecord.observationTimestamp,
              logicalObservationId: lastRecord.logicalObservationId,
            }),
          })
        : undefined;

    return { items: page, nextToken };
  }

  async findRelevantPreviousObservation(
    input: FindRelevantPreviousObservationInput,
  ): Promise<EvidenceObservationRecord | null> {
    const all = [...(this.byFinding.get(findingIndexKey(input.tenantId, input.accountId, input.findingKey)) ?? [])];
    return selectLatestRelevantPreviousFromCandidates(all, input);
  }

  async recordObservation(
    input: RecordEvidenceObservationInput,
  ): Promise<RecordEvidenceObservationResult> {
    const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
    const collectionTimestamp = normalizeObservationTimestampIso(input.collectionTimestamp);
    const logicalObservationId = buildLogicalObservationId({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
      observationTimestamp: observationTimestampIso,
    });
    const key = storageKey(input.tenantId, input.accountId, logicalObservationId);
    const existing = this.byLogicalId.get(key);
    if (existing) {
      return { observation: existing, assessment: existing.assessment, created: false };
    }

    const relevantPrevious = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: observationTimestampIso,
      excludeLogicalObservationId: logicalObservationId,
    });
    const assessment = assessPersistence({
      request: {
        ...input,
        observationTimestamp: observationTimestampIso,
        collectionTimestamp,
      },
      priorObservations: relevantPrevious ? [relevantPrevious] : [],
    });

    const record: EvidenceObservationRecord = {
      observationId: randomUUID(),
      logicalObservationId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      service: input.service,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      findingKey: input.findingKey,
      recommendationId: input.recommendationId,
      recommendationFingerprint: assessment.recommendationFingerprint,
      recommendedAction: input.recommendedAction,
      category: input.category,
      ruleId: input.ruleId,
      ruleVersion: input.ruleVersion,
      analysisRunId: input.analysisRunId,
      jobId: input.jobId,
      correlationId: input.correlationId,
      provenance: input.provenance,
      observationTimestamp: observationTimestampIso,
      collectionTimestamp,
      persistedAt: new Date().toISOString(),
      assessment,
      version: 1,
    };

    if (this.byLogicalId.has(key)) {
      throw new RepositoryConflictError('Evidence observation write conflict.');
    }

    this.byLogicalId.set(key, record);
    const findingKey = findingIndexKey(input.tenantId, input.accountId, input.findingKey);
    const list = this.byFinding.get(findingKey) ?? [];
    list.push(record);
    this.byFinding.set(findingKey, list);

    return { observation: record, assessment, created: true };
  }
}
