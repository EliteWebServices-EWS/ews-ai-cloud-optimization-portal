import { randomUUID } from 'node:crypto';

import {
  governanceConvergenceMissingResultSortKey,
  governanceConvergenceObservationResultSortKey,
  governanceConvergenceLatestSortKey,
  parseGovernanceConvergenceFindingKeyOwner,
} from '../../database/cloud-resources/governance-convergence-keys';
import {
  assessGovernanceConvergence,
  buildMissingEvidenceAssessment,
} from '../../governance-convergence/governance-convergence-engine';
import {
  buildMissingLogicalResultId,
  buildObservationBackedLogicalResultId,
} from '../../governance-convergence/governance-convergence-result-identity';
import {
  buildLogicalObservationId,
  latestObservedControlCandidateShouldAdvance,
  selectRelevantPreviousObservation,
  sortObservationsByObservationTimestamp,
} from '../../governance-convergence/observation-ordering';
import { normalizeObservationTimestampIso } from '../../governance-convergence/timestamp-rules';
import type {
  GovernanceConvergenceAssessment,
  GovernanceConvergenceResultRecord,
  GovernanceEvidenceObservationRecord,
  GovernanceLatestObservedControlRecord,
  RecordGovernanceEvidenceObservationInput,
  RecordGovernanceEvidenceObservationResult,
  UpsertGovernanceLatestObservedControlInput,
} from '../../governance-convergence/types';
import type {
  FindRelevantPreviousGovernanceObservationInput,
  GetGovernanceConvergenceObservationByLogicalIdInput,
  GovernanceConvergenceListQuery,
  GovernanceConvergenceRepository,
  ListLatestObservedControlsQuery,
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

function resultStorageKey(pk: string, sk: string): string {
  return `${pk}||${sk}`;
}

function latestCheckpointStorageKey(tenantId: string, accountId: string, sk: string): string {
  return `${tenantId}#${accountId}#${sk}`;
}

export class MockGovernanceConvergenceRepository implements GovernanceConvergenceRepository {
  private readonly observationsByLogicalId = new Map<string, GovernanceEvidenceObservationRecord>();
  private readonly observationsByFinding = new Map<string, GovernanceEvidenceObservationRecord[]>();
  private readonly resultsByKey = new Map<string, GovernanceConvergenceResultRecord>();
  private readonly resultsByFinding = new Map<string, GovernanceConvergenceResultRecord[]>();
  private readonly latestObservedControls = new Map<string, GovernanceLatestObservedControlRecord>();

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

  private storeResult(record: GovernanceConvergenceResultRecord, pk: string, sk: string): void {
    this.resultsByKey.set(resultStorageKey(pk, sk), record);
    const indexKey = findingIndexKey(record.tenantId, record.accountId, record.findingKey);
    const list = this.resultsByFinding.get(indexKey) ?? [];
    if (!list.some((item) => item.resultId === record.resultId)) {
      list.push(record);
      this.resultsByFinding.set(indexKey, list);
    }
  }

  private async recoverResultForObservation(
    observation: GovernanceEvidenceObservationRecord,
    input: RecordGovernanceEvidenceObservationInput,
  ): Promise<GovernanceConvergenceResultRecord | undefined> {
    const logicalResultId = buildObservationBackedLogicalResultId({
      tenantId: observation.tenantId,
      accountId: observation.accountId,
      findingKey: observation.findingKey,
      logicalObservationId: observation.logicalObservationId,
    });
    const existing = this.resultsByFinding
      .get(findingIndexKey(observation.tenantId, observation.accountId, observation.findingKey))
      ?.find((result) => result.resultId === logicalResultId);
    if (existing) {
      return existing;
    }

    const relevantPrevious = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: observation.observationTimestamp,
      excludeLogicalObservationId: observation.logicalObservationId,
    });

    const assessment = assessGovernanceConvergence({
      currentEvidence: input.evidence,
      currentObservationId: observation.observationId,
      previousObservation: relevantPrevious,
      evaluatedAt: observation.persistedAt,
    });
    if (!assessment) {
      return undefined;
    }

    return this.persistObservationBackedResult(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: input.region,
        resourceId: input.resourceId,
        check: input.check,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
        logicalObservationId: observation.logicalObservationId,
        sourceObservationTimestamp: observation.observationTimestamp,
      },
      assessment,
    );
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
      const recovered = await this.recoverResultForObservation(existing, input);
      return { observation: existing, result: recovered, created: false };
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
      const raced = this.observationsByLogicalId.get(key)!;
      const recovered = await this.recoverResultForObservation(raced, input);
      return { observation: raced, result: recovered, created: false };
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
      result = this.persistObservationBackedResult(
        {
          tenantId: input.tenantId,
          accountId: input.accountId,
          region: input.region,
          resourceId: input.resourceId,
          check: input.check,
          findingKey: input.findingKey,
          analysisRunId: input.analysisRunId,
          logicalObservationId,
          sourceObservationTimestamp: observationTimestampIso,
        },
        assessment,
      );
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

    const logicalResultId = buildMissingLogicalResultId({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
    });
    const existing = this.resultsByFinding
      .get(findingIndexKey(input.tenantId, input.accountId, input.findingKey))
      ?.find((result) => result.resultId === logicalResultId);
    if (existing) {
      return existing;
    }

    const assessment = buildMissingEvidenceAssessment({
      previousObservation: previous,
      evaluatedAt: input.evaluatedAt,
    });

    return this.persistMissingResult(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: previous.region,
        resourceId: previous.resourceId,
        check: previous.check,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
        logicalResultId,
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

  async upsertLatestObservedControl(
    input: UpsertGovernanceLatestObservedControlInput,
  ): Promise<GovernanceLatestObservedControlRecord> {
    const latestObservationTimestamp = normalizeObservationTimestampIso(input.latestObservationTimestamp);
    const sk = governanceConvergenceLatestSortKey({
      region: input.region,
      resourceId: input.resourceId,
      check: input.check,
    });
    const storageKey = latestCheckpointStorageKey(input.tenantId, input.accountId, sk);
    const existing = this.latestObservedControls.get(storageKey);
    if (
      existing &&
      !latestObservedControlCandidateShouldAdvance(
        {
          latestObservationTimestamp,
          latestLogicalObservationId: input.latestLogicalObservationId,
        },
        {
          latestObservationTimestamp: existing.latestObservationTimestamp,
          latestLogicalObservationId: existing.latestLogicalObservationId,
        },
      )
    ) {
      return existing;
    }

    const record: GovernanceLatestObservedControlRecord = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      resourceId: input.resourceId,
      check: input.check,
      findingKey: input.findingKey,
      latestObservationId: input.latestObservationId,
      latestLogicalObservationId: input.latestLogicalObservationId,
      latestObservationTimestamp,
      latestAnalysisRunId: input.latestAnalysisRunId,
      latestRuleVersion: input.latestRuleVersion,
      resourceLifecycleStatus: input.resourceLifecycleStatus,
      updatedAt: new Date().toISOString(),
      version: existing ? existing.version + 1 : 1,
    };
    this.latestObservedControls.set(storageKey, record);
    return record;
  }

  async listLatestObservedControls(
    query: ListLatestObservedControlsQuery,
  ): Promise<PageResult<GovernanceLatestObservedControlRecord>> {
    const regionSet = new Set(query.regions);
    const all = [...this.latestObservedControls.values()]
      .filter(
        (checkpoint) =>
          checkpoint.tenantId === query.tenantId &&
          checkpoint.accountId === query.accountId &&
          regionSet.has(checkpoint.region),
      )
      .sort((left, right) => {
        const regionCompare = left.region.localeCompare(right.region);
        if (regionCompare !== 0) {
          return regionCompare;
        }
        const resourceCompare = left.resourceId.localeCompare(right.resourceId);
        if (resourceCompare !== 0) {
          return resourceCompare;
        }
        return left.check.localeCompare(right.check);
      });
    const limit = normalizePageSize(query.limit);
    const startIndex = query.nextToken ? Number.parseInt(query.nextToken, 10) || 0 : 0;
    const page = all.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + page.length;
    return {
      items: page,
      nextToken: nextIndex < all.length ? String(nextIndex) : undefined,
    };
  }

  private persistObservationBackedResult(
    identity: {
      tenantId: string;
      accountId: string;
      region: string;
      resourceId: string;
      check: string;
      findingKey: string;
      analysisRunId: string;
      logicalObservationId: string;
      sourceObservationTimestamp: string;
    },
    assessment: GovernanceConvergenceAssessment,
  ): GovernanceConvergenceResultRecord {
    const logicalResultId = buildObservationBackedLogicalResultId({
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      findingKey: identity.findingKey,
      logicalObservationId: identity.logicalObservationId,
      ruleVersion: assessment.ruleVersion,
    });
    const existing = this.resultsByFinding
      .get(findingIndexKey(identity.tenantId, identity.accountId, identity.findingKey))
      ?.find((result) => result.resultId === logicalResultId);
    if (existing) {
      return existing;
    }

    const record: GovernanceConvergenceResultRecord = {
      ...assessment,
      resultId: logicalResultId,
      currentLogicalObservationId: identity.logicalObservationId,
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
    const sk = governanceConvergenceObservationResultSortKey({
      findingKey: identity.findingKey,
      sourceObservationTimestampIso: normalizeObservationTimestampIso(identity.sourceObservationTimestamp),
      logicalResultId,
    });
    this.storeResult(record, `mock-pk-${identity.tenantId}-${identity.accountId}`, sk);
    return record;
  }

  private persistMissingResult(
    identity: {
      tenantId: string;
      accountId: string;
      region: string;
      resourceId: string;
      check: string;
      findingKey: string;
      analysisRunId: string;
      logicalResultId: string;
    },
    assessment: GovernanceConvergenceAssessment,
  ): GovernanceConvergenceResultRecord {
    const existing = this.resultsByFinding
      .get(findingIndexKey(identity.tenantId, identity.accountId, identity.findingKey))
      ?.find((result) => result.resultId === identity.logicalResultId);
    if (existing) {
      return existing;
    }

    const record: GovernanceConvergenceResultRecord = {
      ...assessment,
      resultId: identity.logicalResultId,
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
    const sk = governanceConvergenceMissingResultSortKey({
      findingKey: identity.findingKey,
      analysisRunId: identity.analysisRunId,
      logicalResultId: identity.logicalResultId,
    });
    this.storeResult(record, `mock-pk-${identity.tenantId}-${identity.accountId}`, sk);
    return record;
  }
}
