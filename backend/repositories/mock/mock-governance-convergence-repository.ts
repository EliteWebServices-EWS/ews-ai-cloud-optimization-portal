import { randomUUID } from 'node:crypto';

import { RepositoryConflictError } from '../../database';
import {
  assessGovernanceConvergence,
  buildMissingEvidenceAssessment,
} from '../../governance-convergence/governance-convergence-engine';
import {
  buildLogicalObservationId,
  selectRelevantPreviousObservation,
  sortObservationsByObservationTimestamp,
} from '../../governance-convergence/observation-ordering';
import { normalizeObservationTimestampIso } from '../../governance-convergence/timestamp-rules';
import { parseGovernanceConvergenceFindingKeyOwner } from '../../database/cloud-resources/governance-convergence-keys';
import type {
  GovernanceConvergenceAssessment,
  GovernanceConvergenceResultRecord,
  GovernanceEvidenceObservationRecord,
  RecordGovernanceEvidenceObservationInput,
  RecordGovernanceEvidenceObservationResult,
} from '../../governance-convergence/types';
import type {
  FindRelevantPreviousGovernanceObservationInput,
  GetGovernanceConvergenceObservationByLogicalIdInput,
  GovernanceConvergenceListQuery,
  GovernanceConvergenceRepository,
  RecordGovernanceMissingEvidenceInput,
} from '../contracts/governance-convergence-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';

function observationStorageKey(tenantId: string, accountId: string, logicalObservationId: string): string {
  return `${tenantId}#${accountId}#${logicalObservationId}`;
}

function findingIndexKey(tenantId: string, accountId: string, findingKey: string): string {
  return `${tenantId}#${accountId}#${findingKey}`;
}

export class MockGovernanceConvergenceRepository implements GovernanceConvergenceRepository {
  private readonly observationsByLogicalId = new Map<string, GovernanceEvidenceObservationRecord>();
  private readonly observationsByFinding = new Map<string, GovernanceEvidenceObservationRecord[]>();
  private readonly resultsByFinding = new Map<string, GovernanceConvergenceResultRecord[]>();

  async getObservationByLogicalId(
    input: GetGovernanceConvergenceObservationByLogicalIdInput,
  ): Promise<GovernanceEvidenceObservationRecord | null> {
    const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
    const logicalObservationId = buildLogicalObservationId({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
      observationTimestamp: observationTimestampIso,
    });
    return (
      this.observationsByLogicalId.get(
        observationStorageKey(input.tenantId, input.accountId, logicalObservationId),
      ) ?? null
    );
  }

  async findRelevantPreviousObservation(
    input: FindRelevantPreviousGovernanceObservationInput,
  ): Promise<GovernanceEvidenceObservationRecord | null> {
    const all = (
      this.observationsByFinding.get(findingIndexKey(input.tenantId, input.accountId, input.findingKey)) ?? []
    ).filter((observation) => observation.tenantId === input.tenantId);
    return selectRelevantPreviousObservation(
      all,
      input.beforeObservationTimestamp,
      input.excludeLogicalObservationId,
    );
  }

  async listObservationsForFinding(
    query: GovernanceConvergenceListQuery,
  ): Promise<PageResult<GovernanceEvidenceObservationRecord>> {
    const all = sortObservationsByObservationTimestamp(
      (
        this.observationsByFinding.get(findingIndexKey(query.tenantId, query.accountId, query.findingKey)) ?? []
      ).filter((observation) => observation.tenantId === query.tenantId),
    );
    const limit = normalizePageSize(query.limit);
    const startIndex = query.nextToken ? Number.parseInt(query.nextToken, 10) || 0 : 0;
    const page = all.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + page.length;
    return {
      items: page,
      nextToken: nextIndex < all.length ? String(nextIndex) : undefined,
    };
  }

  async recordObservation(
    input: RecordGovernanceEvidenceObservationInput,
  ): Promise<RecordGovernanceEvidenceObservationResult> {
    const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
    const collectionTimestamp = normalizeObservationTimestampIso(input.collectionTimestamp);
    const logicalObservationId = buildLogicalObservationId({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
      observationTimestamp: observationTimestampIso,
    });
    const key = observationStorageKey(input.tenantId, input.accountId, logicalObservationId);
    const existing = this.observationsByLogicalId.get(key);
    if (existing) {
      const latestResult = await this.getLatestResult(input.tenantId, input.accountId, input.findingKey);
      const matchingResult =
        latestResult && latestResult.currentEvidenceId === existing.observationId ? latestResult : undefined;
      return { observation: existing, result: matchingResult, created: false };
    }

    const relevantPrevious = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: observationTimestampIso,
      excludeLogicalObservationId: logicalObservationId,
    });

    const record: GovernanceEvidenceObservationRecord = {
      observationId: randomUUID(),
      logicalObservationId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      resourceType: 'INSTANCE',
      resourceId: input.resourceId,
      check: input.check,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
      observationTimestamp: observationTimestampIso,
      collectionTimestamp,
      persistedAt: new Date().toISOString(),
      evidence: input.evidence,
      version: 1,
    };

    if (this.observationsByLogicalId.has(key)) {
      throw new RepositoryConflictError('Governance evidence observation write conflict.');
    }

    this.observationsByLogicalId.set(key, record);
    const findingKey = findingIndexKey(input.tenantId, input.accountId, input.findingKey);
    const list = this.observationsByFinding.get(findingKey) ?? [];
    list.push(record);
    this.observationsByFinding.set(findingKey, list);

    const assessment = assessGovernanceConvergence({
      currentEvidence: input.evidence,
      currentObservationId: record.observationId,
      previousObservation: relevantPrevious,
      evaluatedAt: record.persistedAt,
    });

    let result: GovernanceConvergenceResultRecord | undefined;
    if (assessment) {
      result = this.persistResult(input, assessment);
    }

    return { observation: record, result, created: true };
  }

  async recordMissingEvidence(
    input: RecordGovernanceMissingEvidenceInput,
  ): Promise<GovernanceConvergenceResultRecord | null> {
    const previous = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: input.evaluatedAt,
    });
    if (!previous) {
      return null;
    }

    const assessment = buildMissingEvidenceAssessment({
      previousObservation: previous,
      evaluatedAt: input.evaluatedAt,
    });

    return this.persistResult(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: previous.region,
        resourceId: previous.resourceId,
        check: previous.check,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
      },
      assessment,
    );
  }

  async getLatestResult(
    tenantId: string,
    accountId: string,
    findingKey: string,
  ): Promise<GovernanceConvergenceResultRecord | null> {
    const all = (this.resultsByFinding.get(findingIndexKey(tenantId, accountId, findingKey)) ?? []).filter(
      (result) => result.tenantId === tenantId,
    );
    if (all.length === 0) {
      return null;
    }
    return [...all].sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))[0]!;
  }

  async listResultsForFinding(
    query: GovernanceConvergenceListQuery,
  ): Promise<PageResult<GovernanceConvergenceResultRecord>> {
    const all = [
      ...(this.resultsByFinding.get(findingIndexKey(query.tenantId, query.accountId, query.findingKey)) ?? []),
    ]
      .filter((result) => result.tenantId === query.tenantId)
      .sort((left, right) => left.evaluatedAt.localeCompare(right.evaluatedAt));
    const limit = normalizePageSize(query.limit);
    const startIndex = query.nextToken ? Number.parseInt(query.nextToken, 10) || 0 : 0;
    const page = all.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + page.length;
    return {
      items: page,
      nextToken: nextIndex < all.length ? String(nextIndex) : undefined,
    };
  }

  async resolveOwnerTenantId(findingKey: string): Promise<string | undefined> {
    return parseGovernanceConvergenceFindingKeyOwner(findingKey);
  }

  private persistResult(
    identity: {
      tenantId: string;
      accountId: string;
      region: string;
      resourceId: string;
      check: string;
      findingKey: string;
      analysisRunId: string;
    },
    assessment: GovernanceConvergenceAssessment,
  ): GovernanceConvergenceResultRecord {
    const record: GovernanceConvergenceResultRecord = {
      ...assessment,
      resultId: randomUUID(),
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      region: identity.region,
      resourceType: 'INSTANCE',
      resourceId: identity.resourceId,
      check: identity.check,
      findingKey: identity.findingKey,
      analysisRunId: identity.analysisRunId,
      persistedAt: new Date().toISOString(),
      version: 1,
    };
    const key = findingIndexKey(identity.tenantId, identity.accountId, identity.findingKey);
    const list = this.resultsByFinding.get(key) ?? [];
    list.push(record);
    this.resultsByFinding.set(key, list);
    return record;
  }
}
