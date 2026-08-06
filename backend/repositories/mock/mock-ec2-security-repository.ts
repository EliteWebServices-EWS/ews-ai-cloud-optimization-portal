import { randomUUID } from 'node:crypto';

import { RepositoryConflictError, RepositoryNotFoundError } from '../../database';
import {
  buildEc2SecurityFindingKey,
  ec2SecurityFindingSortKey,
  EC2_SECURITY_RULE_VERSION,
} from '../../database/cloud-resources/ec2-security-keys';
import { cloudResourceAccountPartitionKey } from '../../database';
import {
  decodeEc2SecurityFindingNextToken,
  encodeEc2SecurityFindingNextToken,
} from '../ec2-security-finding-pagination';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import type {
  CompleteEc2SecurityAnalysisRunInput,
  CreateEc2SecurityAnalysisRunInput,
  Ec2SecurityAnalysisRunRepository,
  Ec2SecurityFindingListQuery,
  Ec2SecurityFindingRepository,
  Ec2SecuritySummaryRepository,
  UpsertEc2SecurityFindingInput,
} from '../contracts/ec2-security-repository';
import type {
  Ec2SecurityAnalysisRunRecord,
  Ec2SecurityFindingRecord,
  Ec2SecuritySummaryRecord,
} from '../../cloud-intelligence/ec2-security/ec2-security-models';

function runKey(tenantId: string, accountId: string, runId: string): string {
  return `${tenantId}#${accountId}#${runId}`;
}

function summaryKey(tenantId: string, accountId: string, region: string): string {
  return `${tenantId}#${accountId}#${region}`;
}

export class MockEc2SecurityRepository
  implements
    Ec2SecurityFindingRepository,
    Ec2SecuritySummaryRepository,
    Ec2SecurityAnalysisRunRepository
{
  private readonly findings = new Map<string, Ec2SecurityFindingRecord>();
  private readonly summaries = new Map<string, Ec2SecuritySummaryRecord>();
  private readonly runs = new Map<string, Ec2SecurityAnalysisRunRecord>();

  async upsertFinding(input: UpsertEc2SecurityFindingInput): Promise<Ec2SecurityFindingRecord> {
    const now = new Date().toISOString();
    const existing = this.findings.get(input.findingKey);
    if (existing) {
      const preservedStatus =
        existing.status === 'ACKNOWLEDGED' || existing.status === 'DISMISSED'
          ? existing.status
          : input.finding.status === 'OPEN' || input.finding.status === undefined
            ? 'OPEN'
            : (input.finding.status ?? 'OPEN');
      const updated: Ec2SecurityFindingRecord = {
        ...existing,
        ...input.finding,
        findingId: existing.findingId,
        findingKey: input.findingKey,
        ruleVersion: input.finding.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
        firstDetectedAt: existing.firstDetectedAt,
        lastDetectedAt: now,
        status: preservedStatus,
        resolvedAt:
          preservedStatus === 'OPEN'
            ? undefined
            : preservedStatus === 'RESOLVED'
              ? existing.resolvedAt
              : existing.resolvedAt,
        version: existing.version + 1,
        updatedAt: now,
      };
      this.findings.set(input.findingKey, updated);
      return updated;
    }
    const created: Ec2SecurityFindingRecord = {
      ...(input.finding as Ec2SecurityFindingRecord),
      findingId: input.finding.findingId ?? `ec2sec-${randomUUID()}`,
      findingKey: input.findingKey,
      ruleVersion: input.finding.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
      status: input.finding.status ?? 'OPEN',
      firstDetectedAt: input.finding.firstDetectedAt ?? now,
      lastDetectedAt: input.finding.lastDetectedAt ?? now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.findings.set(input.findingKey, created);
    return created;
  }

  async getFinding(
    tenantId: string,
    accountId: string,
    findingId: string,
  ): Promise<Ec2SecurityFindingRecord | null> {
    for (const finding of this.findings.values()) {
      if (
        finding.findingId === findingId &&
        finding.tenantId === tenantId &&
        finding.accountId === accountId
      ) {
        return finding;
      }
    }
    return null;
  }

  async getFindingByKey(
    tenantId: string,
    accountId: string,
    findingKey: string,
  ): Promise<Ec2SecurityFindingRecord | null> {
    const finding = this.findings.get(findingKey);
    if (!finding || finding.tenantId !== tenantId || finding.accountId !== accountId) {
      return null;
    }
    return finding;
  }

  async listFindings(query: Ec2SecurityFindingListQuery): Promise<
    PageResult<Ec2SecurityFindingRecord>
  > {
    const limit = normalizePageSize(query.limit);
    let items = [...this.findings.values()].filter(
      (f) => f.tenantId === query.tenantId && f.accountId === query.accountId,
    );
    if (query.region) {
      items = items.filter((f) => f.region === query.region);
    }
    if (query.severity) {
      items = items.filter((f) => f.severity === query.severity);
    }
    if (query.category) {
      items = items.filter((f) => f.category === query.category);
    }
    if (query.status) {
      items = items.filter((f) => f.status === query.status);
    }
    if (query.resourceId) {
      items = items.filter((f) => f.resourceId === query.resourceId);
    }
    items.sort((a, b) => a.findingId.localeCompare(b.findingId));

    let startIndex = 0;
    if (query.nextToken) {
      const key = decodeEc2SecurityFindingNextToken(query.nextToken, query);
      if (key?.sk) {
        const marker = String(key.sk);
        const found = items.findIndex((item) => {
          const sk = ec2SecurityFindingSortKey({
            region: item.region,
            resourceId: item.resourceId,
            check: item.check,
            ruleVersion: item.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
          });
          return sk.localeCompare(marker) > 0;
        });
        startIndex = found >= 0 ? found : items.length;
      }
    }

    const slice = items.slice(startIndex, startIndex + limit);
    const last = slice[slice.length - 1];
    let nextToken: string | undefined;
    if (slice.length === limit && startIndex + limit < items.length && last) {
      nextToken = encodeEc2SecurityFindingNextToken(query, {
        pk: cloudResourceAccountPartitionKey(query.tenantId, query.accountId),
        sk: ec2SecurityFindingSortKey({
          region: last.region,
          resourceId: last.resourceId,
          check: last.check,
          ruleVersion: last.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
        }),
      });
    }
    return { items: slice, nextToken };
  }

  async listOpenFindingKeys(
    tenantId: string,
    accountId: string,
    _analysisRunId: string,
  ): Promise<string[]> {
    return [...this.findings.values()]
      .filter(
        (f) => f.tenantId === tenantId && f.accountId === accountId && f.status === 'OPEN',
      )
      .map((f) => f.findingKey);
  }

  async markResolved(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
    expectedVersion: number;
    resolvedAt: string;
  }): Promise<Ec2SecurityFindingRecord> {
    const existing = this.findings.get(input.findingKey);
    if (!existing || existing.tenantId !== input.tenantId || existing.accountId !== input.accountId) {
      throw new RepositoryNotFoundError('EC2 security finding not found.');
    }
    if (existing.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 security finding version conflict.');
    }
    const updated: Ec2SecurityFindingRecord = {
      ...existing,
      status: 'RESOLVED',
      resolvedAt: input.resolvedAt,
      version: existing.version + 1,
      updatedAt: input.resolvedAt,
    };
    this.findings.set(input.findingKey, updated);
    return updated;
  }

  async upsertSummary(input: Ec2SecuritySummaryRecord): Promise<Ec2SecuritySummaryRecord> {
    const key = summaryKey(input.tenantId, input.accountId, input.region);
    const existing = this.summaries.get(key);
    const now = new Date().toISOString();
    if (existing) {
      const updated = { ...existing, ...input, version: existing.version + 1, updatedAt: now };
      this.summaries.set(key, updated);
      return updated;
    }
    const created = { ...input, createdAt: now, updatedAt: now };
    this.summaries.set(key, created);
    return created;
  }

  async getLatestSummary(
    tenantId: string,
    accountId: string,
    region: string,
  ): Promise<Ec2SecuritySummaryRecord | null> {
    return this.summaries.get(summaryKey(tenantId, accountId, region)) ?? null;
  }

  async listSummariesForAccount(
    tenantId: string,
    accountId: string,
  ): Promise<Ec2SecuritySummaryRecord[]> {
    return [...this.summaries.values()].filter(
      (summary) => summary.tenantId === tenantId && summary.accountId === accountId,
    );
  }

  async createRun(input: CreateEc2SecurityAnalysisRunInput): Promise<Ec2SecurityAnalysisRunRecord> {
    const now = input.startedAt;
    const record: Ec2SecurityAnalysisRunRecord = {
      runId: input.runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      regions: input.regions,
      status: 'RUNNING',
      startedAt: input.startedAt,
      instancesFound: 0,
      instancesAnalyzed: 0,
      findingsCreated: 0,
      findingsUpdated: 0,
      findingsResolved: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(runKey(input.tenantId, input.accountId, input.runId), record);
    return record;
  }

  async completeRun(
    input: CompleteEc2SecurityAnalysisRunInput,
  ): Promise<Ec2SecurityAnalysisRunRecord> {
    const key = runKey(input.tenantId, input.accountId, input.runId);
    const existing = this.runs.get(key);
    if (!existing) {
      throw new RepositoryNotFoundError('EC2 security analysis run not found.');
    }
    if (existing.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 security analysis run version conflict.');
    }
    const updated: Ec2SecurityAnalysisRunRecord = {
      ...existing,
      status: input.status,
      completedAt: input.completedAt,
      instancesFound: input.instancesFound,
      instancesAnalyzed: input.instancesAnalyzed,
      findingsCreated: input.findingsCreated,
      findingsUpdated: input.findingsUpdated,
      findingsResolved: input.findingsResolved,
      version: existing.version + 1,
      updatedAt: input.completedAt,
    };
    this.runs.set(key, updated);
    return updated;
  }

  async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2SecurityAnalysisRunRecord | null> {
    return this.runs.get(runKey(tenantId, accountId, runId)) ?? null;
  }

  /** Test helper */
  seedFinding(partial: Ec2SecurityFindingRecord): Ec2SecurityFindingRecord {
    const findingKey =
      partial.findingKey ??
      buildEc2SecurityFindingKey({
        tenantId: partial.tenantId,
        accountId: partial.accountId,
        region: partial.region,
        resourceId: partial.resourceId,
        check: partial.check,
      });
    this.findings.set(findingKey, { ...partial, findingKey });
    return partial;
  }
}
