import { randomUUID } from 'node:crypto';

import { RepositoryConflictError, RepositoryNotFoundError } from '../../database';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import type {
  ClaimEc2CostAnalysisRunExecutionInput,
  CompleteEc2CostAnalysisRunInput,
  CreateEc2CostAnalysisRunInput,
  Ec2CostAnalysisRunRepository,
  Ec2CostRecommendationListQuery,
  Ec2CostRecommendationRepository,
  UpsertEc2CostRecommendationInput,
} from '../contracts/ec2-cost-repository';
import type {
  Ec2CostAnalysisRunRecord,
  Ec2CostRecommendationRecord,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { mergeRecommendationLifecycleOnUpsert } from '../../cloud-intelligence/ec2-cost/ec2-cost-resolution-policy';
import {
  decodeEc2CostRecommendationNextToken,
  encodeEc2CostRecommendationNextToken,
} from '../ec2-cost-recommendation-pagination';
import {
  applyMockStageRunExecutionReclaim,
  planStageRunExecutionClaim,
} from '../ec2-stage-run-execution-claim';

function runKey(tenantId: string, accountId: string, runId: string): string {
  return `${tenantId}#${accountId}#${runId}`;
}

export interface MockEc2CostRepositoryOptions {
  /** Injectable clock for recommendation first/lastDetectedAt in tests. Run records use wall clock. */
  recommendationNow?: () => Date;
}

export class MockEc2CostRepository
  implements Ec2CostRecommendationRepository, Ec2CostAnalysisRunRepository
{
  private readonly recommendations = new Map<string, Ec2CostRecommendationRecord>();
  private readonly runs = new Map<string, Ec2CostAnalysisRunRecord>();
  private readonly openKeysByRun = new Map<string, Set<string>>();
  private readonly recommendationNow: () => Date;

  constructor(options: MockEc2CostRepositoryOptions = {}) {
    this.recommendationNow = options.recommendationNow ?? (() => new Date());
  }

  private recommendationNowIso(): string {
    return this.recommendationNow().toISOString();
  }

  async upsertRecommendation(input: UpsertEc2CostRecommendationInput): Promise<Ec2CostRecommendationRecord> {
    const existing = this.recommendations.get(input.findingKey);
    const now = this.recommendationNowIso();
    if (existing) {
      const updated: Ec2CostRecommendationRecord = {
        ...existing,
        ...input.recommendation,
        recommendationId: existing.recommendationId,
        firstDetectedAt: existing.firstDetectedAt,
        lastDetectedAt: now,
        version: existing.version + 1,
        updatedAt: now,
        lifecycleStatus: mergeRecommendationLifecycleOnUpsert(
          existing,
          input.recommendation.lifecycleStatus,
        ),
        resolvedAt:
          existing.lifecycleStatus === 'RESOLVED' && mergeRecommendationLifecycleOnUpsert(
            existing,
            input.recommendation.lifecycleStatus,
          ) === 'OPEN'
            ? undefined
            : existing.resolvedAt,
      };
      this.recommendations.set(input.findingKey, updated);
      return updated;
    }
    const created: Ec2CostRecommendationRecord = {
      ...(input.recommendation as Ec2CostRecommendationRecord),
      recommendationId: input.recommendation.recommendationId ?? `ec2rec-${randomUUID()}`,
      findingKey: input.findingKey,
      firstDetectedAt: input.recommendation.firstDetectedAt ?? now,
      lastDetectedAt: input.recommendation.lastDetectedAt ?? now,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lifecycleStatus: input.recommendation.lifecycleStatus ?? 'OPEN',
    };
    this.recommendations.set(input.findingKey, created);
    return created;
  }

  async getRecommendation(
    tenantId: string,
    accountId: string,
    recommendationId: string,
  ): Promise<Ec2CostRecommendationRecord | null> {
    for (const rec of this.recommendations.values()) {
      if (
        rec.recommendationId === recommendationId &&
        rec.tenantId === tenantId &&
        rec.accountId === accountId
      ) {
        return rec;
      }
    }
    return null;
  }

  async listRecommendations(query: Ec2CostRecommendationListQuery): Promise<
    PageResult<Ec2CostRecommendationRecord>
  > {
    const limit = normalizePageSize(query.limit);
    let items = [...this.recommendations.values()].filter(
      (r) => r.tenantId === query.tenantId && r.accountId === query.accountId,
    );
    if (query.region) {
      items = items.filter((r) => r.region === query.region);
    }
    if (query.category) {
      items = items.filter((r) => r.category === query.category);
    }
    if (query.severity) {
      items = items.filter((r) => r.severity === query.severity);
    }
    if (query.confidenceLevel) {
      items = items.filter((r) => r.confidenceLevel === query.confidenceLevel);
    }
    if (query.lifecycleStatus) {
      items = items.filter((r) => r.lifecycleStatus === query.lifecycleStatus);
    }
    if (query.resourceId) {
      items = items.filter((r) => r.resourceId === query.resourceId);
    }
    items.sort((a, b) => a.recommendationId.localeCompare(b.recommendationId));

    let start = 0;
    if (query.nextToken) {
      const key = decodeEc2CostRecommendationNextToken(query.nextToken, query);
      if (key?.sk) {
        const sk = String(key.sk);
        const idx = items.findIndex((item) =>
          sk.includes(item.recommendationId),
        );
        start = idx >= 0 ? idx + 1 : 0;
      }
    }
    const slice = items.slice(start, start + limit);
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextToken:
        start + slice.length < items.length && last
          ? encodeEc2CostRecommendationNextToken(query, {
              pk: `TENANT#${query.tenantId}#AWS_ACCOUNT#${query.accountId}`,
              sk: last.recommendationId,
            })
          : undefined,
    };
  }

  async listOpenFindingKeys(
    tenantId: string,
    accountId: string,
    analysisRunId: string,
  ): Promise<string[]> {
    void analysisRunId;
    return [...this.recommendations.values()]
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.accountId === accountId &&
          r.lifecycleStatus === 'OPEN',
      )
      .map((r) => r.findingKey);
  }

  async markResolved(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
    expectedVersion: number;
    resolvedAt: string;
  }): Promise<Ec2CostRecommendationRecord> {
    const existing = this.recommendations.get(input.findingKey);
    if (!existing || existing.tenantId !== input.tenantId || existing.accountId !== input.accountId) {
      throw new RepositoryNotFoundError('EC2 cost recommendation not found.');
    }
    if (existing.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 cost recommendation version conflict.');
    }
    const updated: Ec2CostRecommendationRecord = {
      ...existing,
      lifecycleStatus: 'RESOLVED',
      resolvedAt: input.resolvedAt,
      version: existing.version + 1,
      updatedAt: input.resolvedAt,
    };
    this.recommendations.set(input.findingKey, updated);
    return updated;
  }

  async createRun(input: CreateEc2CostAnalysisRunInput): Promise<Ec2CostAnalysisRunRecord> {
    const now = new Date().toISOString();
    const record: Ec2CostAnalysisRunRecord = {
      runId: input.runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      regions: input.regions,
      observationDays: input.observationDays,
      periodSeconds: input.periodSeconds,
      requestedAt: input.requestedAt,
      startedAt: input.startedAt,
      status: 'RUNNING',
      instancesFound: 0,
      instancesEvaluated: 0,
      recommendationsCreated: 0,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      insufficientDataCount: 0,
      regionsSucceeded: [],
      regionsFailed: [],
      warnings: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      executionOwnerId: input.executionOwnerId,
      leaseExpiresAt: input.leaseExpiresAt,
      attemptCount: input.attemptCount ?? 1,
    };
    this.runs.set(runKey(input.tenantId, input.accountId, input.runId), record);
    this.openKeysByRun.set(runKey(input.tenantId, input.accountId, input.runId), new Set());
    return record;
  }

  async claimExecution(input: ClaimEc2CostAnalysisRunExecutionInput): Promise<Ec2CostAnalysisRunRecord> {
    const existing = await this.getRun(input.tenantId, input.accountId, input.runId);
    const plan = planStageRunExecutionClaim(
      existing,
      input.nowMs,
      input.executionOwnerIdForAttempt,
    );
    if (plan.kind === 'create') {
      return this.createRun({
        runId: input.runId,
        tenantId: input.tenantId,
        accountId: input.accountId,
        regions: input.regions,
        observationDays: input.observationDays,
        periodSeconds: input.periodSeconds,
        requestedAt: input.requestedAt,
        startedAt: input.startedAt,
        executionOwnerId: plan.executionOwnerId,
        leaseExpiresAt: plan.leaseExpiresAt,
        attemptCount: plan.attemptCount,
      });
    }
    if (!existing) {
      throw new RepositoryNotFoundError('EC2 cost analysis run not found.');
    }
    const updated = applyMockStageRunExecutionReclaim(existing, plan);
    this.runs.set(runKey(input.tenantId, input.accountId, input.runId), updated);
    return updated;
  }

  async completeRun(input: CompleteEc2CostAnalysisRunInput): Promise<Ec2CostAnalysisRunRecord> {
    const key = runKey(input.tenantId, input.accountId, input.runId);
    const existing = this.runs.get(key);
    if (!existing) {
      throw new RepositoryNotFoundError('EC2 cost analysis run not found.');
    }
    if (existing.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 cost analysis run version conflict.');
    }
    const updated: Ec2CostAnalysisRunRecord = {
      ...existing,
      status: input.status,
      completedAt: input.completedAt,
      instancesFound: input.instancesFound,
      instancesEvaluated: input.instancesEvaluated,
      recommendationsCreated: input.recommendationsCreated,
      recommendationsUpdated: input.recommendationsUpdated,
      recommendationsResolved: input.recommendationsResolved,
      insufficientDataCount: input.insufficientDataCount,
      regionsSucceeded: input.regionsSucceeded,
      regionsFailed: input.regionsFailed,
      warnings: input.warnings,
      version: existing.version + 1,
      updatedAt: input.completedAt,
      failureRetryable:
        input.status === 'FAILED' ? input.failureRetryable ?? true : undefined,
    };
    this.runs.set(key, updated);
    return updated;
  }

  async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2CostAnalysisRunRecord | null> {
    return this.runs.get(runKey(tenantId, accountId, runId)) ?? null;
  }

  /** Test helper */
  seedRecommendation(record: Ec2CostRecommendationRecord): void {
    this.recommendations.set(record.findingKey, record);
  }

  /** Test helper */
  static buildFindingKey(
    tenantId: string,
    accountId: string,
    region: string,
    resourceId: string,
    category: string,
    ruleVersion: string,
  ): string {
    return buildEc2CostFindingKey({ tenantId, accountId, region, resourceId, category, ruleVersion });
  }
}
