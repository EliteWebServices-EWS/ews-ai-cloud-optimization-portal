import { randomUUID } from 'node:crypto';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  ec2SecurityAnalysisRunSortKey,
  ec2SecurityFindingSortKey,
  ec2SecurityFindingSortKeyPrefixForAccount,
  ec2SecuritySummarySortKey,
  ec2SecuritySummarySortKeyPrefixForAccount,
  EC2_SECURITY_RULE_VERSION,
  isConditionalCheckFailure,
  parseEc2SecurityFindingKey,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import type {
  ClaimEc2SecurityAnalysisRunExecutionInput,
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
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';
import { planStageRunExecutionClaim } from '../ec2-stage-run-execution-claim';
import {
  decodeEc2SecurityFindingNextToken,
  encodeEc2SecurityFindingNextToken,
} from '../ec2-security-finding-pagination';

interface SecurityFindingItem extends Ec2SecurityFindingRecord {
  pk: string;
  sk: string;
  entityType: 'EC2_SECURITY_FINDING';
}

interface SecuritySummaryItem extends Ec2SecuritySummaryRecord {
  pk: string;
  sk: string;
  entityType: 'EC2_SECURITY_SUMMARY';
}

interface SecurityRunItem extends Ec2SecurityAnalysisRunRecord {
  pk: string;
  sk: string;
  entityType: 'EC2_SECURITY_ANALYSIS_RUN';
}

function stripFinding(item: SecurityFindingItem): Ec2SecurityFindingRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

function stripSummary(item: SecuritySummaryItem): Ec2SecuritySummaryRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

function stripRun(item: SecurityRunItem): Ec2SecurityAnalysisRunRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

export class DynamoDbEc2SecurityRepository
  extends BaseDynamoDbRepository
  implements
    Ec2SecurityFindingRepository,
    Ec2SecuritySummaryRepository,
    Ec2SecurityAnalysisRunRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  async upsertFinding(input: UpsertEc2SecurityFindingInput): Promise<Ec2SecurityFindingRecord> {
    const f = input.finding;
    const pk = cloudResourceAccountPartitionKey(f.tenantId, f.accountId);
    const sk = ec2SecurityFindingSortKey({
      region: f.region,
      resourceId: f.resourceId,
      check: f.check,
      ruleVersion: f.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
    });
    const existing = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const now = new Date().toISOString();
    const prior = existing.Item as SecurityFindingItem | undefined;

    if (prior?.entityType === 'EC2_SECURITY_FINDING') {
      const incomingStatus = f.status ?? 'OPEN';
      const preservedStatus =
        prior.status === 'ACKNOWLEDGED' || prior.status === 'DISMISSED'
          ? prior.status
          : prior.status === 'RESOLVED' && incomingStatus === 'OPEN'
            ? 'OPEN'
            : incomingStatus;
      const updated: SecurityFindingItem = {
        ...prior,
        ...f,
        findingId: prior.findingId,
        findingKey: input.findingKey,
        ruleVersion: f.ruleVersion ?? prior.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
        firstDetectedAt: prior.firstDetectedAt,
        lastDetectedAt: now,
        status: preservedStatus,
        resolvedAt: preservedStatus === 'OPEN' ? undefined : prior.resolvedAt,
        version: prior.version + 1,
        updatedAt: now,
        pk,
        sk,
        entityType: 'EC2_SECURITY_FINDING',
      };
      try {
        await this.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: updated,
            ConditionExpression: '#version = :expected',
            ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: { ':expected': prior.version },
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailure(error)) {
          throw new RepositoryConflictError('EC2 security finding version conflict.');
        }
        throw error;
      }
      return stripFinding(updated);
    }

    const created: SecurityFindingItem = {
      ...(f as Ec2SecurityFindingRecord),
      findingId: f.findingId ?? `ec2sec-${randomUUID()}`,
      findingKey: input.findingKey,
      ruleVersion: f.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
      status: f.status ?? 'OPEN',
      firstDetectedAt: f.firstDetectedAt ?? now,
      lastDetectedAt: f.lastDetectedAt ?? now,
      version: 1,
      createdAt: now,
      updatedAt: now,
      pk,
      sk,
      entityType: 'EC2_SECURITY_FINDING',
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: created,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return stripFinding(created);
  }

  async getFinding(
    tenantId: string,
    accountId: string,
    findingId: string,
  ): Promise<Ec2SecurityFindingRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': ec2SecurityFindingSortKeyPrefixForAccount(),
        },
      }),
    );
    for (const item of response.Items ?? []) {
      const finding = item as SecurityFindingItem;
      if (finding.findingId === findingId) {
        return stripFinding(finding);
      }
    }
    return null;
  }

  async getFindingByKey(
    tenantId: string,
    accountId: string,
    findingKey: string,
  ): Promise<Ec2SecurityFindingRecord | null> {
    const parsed = parseEc2SecurityFindingKey(findingKey);
    if (!parsed || parsed.tenantId !== tenantId || parsed.accountId !== accountId) {
      return null;
    }
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const sk = ec2SecurityFindingSortKey({
      region: parsed.region,
      resourceId: parsed.resourceId,
      check: parsed.check,
      ruleVersion: parsed.ruleVersion,
    });
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    if (!response.Item) {
      return null;
    }
    return stripFinding(response.Item as SecurityFindingItem);
  }

  async listFindings(query: Ec2SecurityFindingListQuery): Promise<
    PageResult<Ec2SecurityFindingRecord>
  > {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const limit = normalizePageSize(query.limit);
    const startKey = decodeEc2SecurityFindingNextToken(query.nextToken, query);
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': ec2SecurityFindingSortKeyPrefixForAccount(),
        },
        ExclusiveStartKey: startKey,
        Limit: limit * 2,
      }),
    );
    let items = (response.Items ?? [])
      .map((item) => stripFinding(item as SecurityFindingItem))
      .filter((f) => f.tenantId === query.tenantId);
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
    const slice = items.slice(0, limit);
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextToken:
        slice.length === limit && last
          ? encodeEc2SecurityFindingNextToken(query, {
              pk,
              sk: ec2SecurityFindingSortKey({
                region: last.region,
                resourceId: last.resourceId,
                check: last.check,
                ruleVersion: last.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
              }),
            })
          : undefined,
    };
  }

  async listOpenFindingKeys(
    tenantId: string,
    accountId: string,
    _analysisRunId: string,
  ): Promise<string[]> {
    const page = await this.listFindings({ tenantId, accountId, status: 'OPEN', limit: 500 });
    return page.items.map((f) => f.findingKey);
  }

  async markResolved(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
    expectedVersion: number;
    resolvedAt: string;
  }): Promise<Ec2SecurityFindingRecord> {
    const listed = await this.listFindings({
      tenantId: input.tenantId,
      accountId: input.accountId,
      limit: 500,
    });
    const match = listed.items.find((f) => f.findingKey === input.findingKey);
    if (!match) {
      throw new RepositoryNotFoundError('EC2 security finding not found.');
    }
    if (match.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 security finding version conflict.');
    }
    const pk = cloudResourceAccountPartitionKey(match.tenantId, match.accountId);
    const sk = ec2SecurityFindingSortKey({
      region: match.region,
      resourceId: match.resourceId,
      check: match.check,
      ruleVersion: match.ruleVersion ?? EC2_SECURITY_RULE_VERSION,
    });
    const updated: SecurityFindingItem = {
      ...match,
      status: 'RESOLVED',
      resolvedAt: input.resolvedAt,
      version: match.version + 1,
      updatedAt: input.resolvedAt,
      pk,
      sk,
      entityType: 'EC2_SECURITY_FINDING',
    };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: updated,
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':expected': match.version },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 security finding version conflict.');
      }
      throw error;
    }
    return stripFinding(updated);
  }

  async upsertSummary(input: Ec2SecuritySummaryRecord): Promise<Ec2SecuritySummaryRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2SecuritySummarySortKey(input.region);
    const existing = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const now = new Date().toISOString();
    const prior = existing.Item as SecuritySummaryItem | undefined;
    const record: SecuritySummaryItem = {
      ...(prior ?? input),
      ...input,
      version: prior ? prior.version + 1 : 1,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      pk,
      sk,
      entityType: 'EC2_SECURITY_SUMMARY',
    };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: record }));
    return stripSummary(record);
  }

  async getLatestSummary(
    tenantId: string,
    accountId: string,
    region: string,
  ): Promise<Ec2SecuritySummaryRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const sk = ec2SecuritySummarySortKey(region);
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    if (!response.Item) {
      return null;
    }
    return stripSummary(response.Item as SecuritySummaryItem);
  }

  async listSummariesForAccount(
    tenantId: string,
    accountId: string,
  ): Promise<Ec2SecuritySummaryRecord[]> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': ec2SecuritySummarySortKeyPrefixForAccount(),
        },
      }),
    );
    return (response.Items ?? []).map((item) => stripSummary(item as SecuritySummaryItem));
  }

  async createRun(input: CreateEc2SecurityAnalysisRunInput): Promise<Ec2SecurityAnalysisRunRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2SecurityAnalysisRunSortKey(input.runId);
    const now = input.startedAt;
    const record: SecurityRunItem = {
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
      pk,
      sk,
      entityType: 'EC2_SECURITY_ANALYSIS_RUN',
      executionOwnerId: input.executionOwnerId,
      leaseExpiresAt: input.leaseExpiresAt,
      attemptCount: input.attemptCount ?? 1,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return stripRun(record);
  }

  async claimExecution(
    input: ClaimEc2SecurityAnalysisRunExecutionInput,
  ): Promise<Ec2SecurityAnalysisRunRecord> {
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
        startedAt: input.startedAt,
        executionOwnerId: plan.executionOwnerId,
        leaseExpiresAt: plan.leaseExpiresAt,
        attemptCount: plan.attemptCount,
      });
    }
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2SecurityAnalysisRunSortKey(input.runId);
    const now = new Date().toISOString();
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression:
            'SET #status = :running, executionOwnerId = :owner, leaseExpiresAt = :lease, attemptCount = :attempt, #updatedAt = :updatedAt, #version = #version + :one REMOVE completedAt, failureRetryable',
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':running': 'RUNNING',
            ':owner': plan.executionOwnerId,
            ':lease': plan.leaseExpiresAt,
            ':attempt': plan.attemptCount,
            ':updatedAt': now,
            ':one': 1,
            ':expected': plan.expectedVersion,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 security analysis run version conflict.');
      }
      throw error;
    }
    const refreshed = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    return stripRun(refreshed.Item as SecurityRunItem);
  }

  async completeRun(
    input: CompleteEc2SecurityAnalysisRunInput,
  ): Promise<Ec2SecurityAnalysisRunRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2SecurityAnalysisRunSortKey(input.runId);
    const existing = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const prior = existing.Item as SecurityRunItem | undefined;
    if (!prior) {
      throw new RepositoryNotFoundError('EC2 security analysis run not found.');
    }
    if (prior.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 security analysis run version conflict.');
    }
    const updated: SecurityRunItem = {
      ...prior,
      status: input.status,
      completedAt: input.completedAt,
      instancesFound: input.instancesFound,
      instancesAnalyzed: input.instancesAnalyzed,
      findingsCreated: input.findingsCreated,
      findingsUpdated: input.findingsUpdated,
      findingsResolved: input.findingsResolved,
      version: prior.version + 1,
      updatedAt: input.completedAt,
      failureRetryable:
        input.status === 'FAILED' ? (input.failureRetryable ?? true) : undefined,
      executionOwnerId: undefined,
      leaseExpiresAt: undefined,
    };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: updated,
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':expected': prior.version },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 security analysis run version conflict.');
      }
      throw error;
    }
    return stripRun(updated);
  }

  async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2SecurityAnalysisRunRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const sk = ec2SecurityAnalysisRunSortKey(runId);
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    if (!response.Item) {
      return null;
    }
    return stripRun(response.Item as SecurityRunItem);
  }
}
