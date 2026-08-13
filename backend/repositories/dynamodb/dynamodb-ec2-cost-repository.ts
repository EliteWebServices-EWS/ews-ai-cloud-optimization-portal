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
  ec2CostAnalysisRunSortKey,
  ec2CostRecommendationSortKey,
  EC2_COST_RECOMMENDATION_SK_PREFIX,
  RepositoryConflictError,
  RepositoryNotFoundError,
  isConditionalCheckFailure,
} from '../../database';

import {
  decodeEc2CostRecommendationNextToken,
  encodeEc2CostRecommendationNextToken,
} from '../ec2-cost-recommendation-pagination';

import type {
  ClaimEc2CostAnalysisRunExecutionInput,
  CompleteEc2CostAnalysisRunInput,
  CreateEc2CostAnalysisRunInput,
  Ec2CostAnalysisRunRepository,
  Ec2CostRecommendationListQuery,
  Ec2CostRecommendationRepository,
  Ec2CostRecommendationScopeQuery,
  UpsertEc2CostRecommendationInput,
} from '../contracts/ec2-cost-repository';
import type {
  Ec2CostAnalysisRunRecord,
  Ec2CostRecommendationRecord,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { mergeRecommendationLifecycleOnUpsert } from '../../cloud-intelligence/ec2-cost/ec2-cost-resolution-policy';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';
import { planStageRunExecutionClaim } from '../ec2-stage-run-execution-claim';

interface CostRunItem extends Ec2CostAnalysisRunRecord {
  pk: string;
  sk: string;
  entityType: 'EC2_COST_ANALYSIS_RUN';
}

interface CostRecommendationItem extends Ec2CostRecommendationRecord {
  pk: string;
  sk: string;
  entityType: 'EC2_COST_RECOMMENDATION';
}

export class DynamoDbEc2CostRepository
  extends BaseDynamoDbRepository
  implements Ec2CostRecommendationRepository, Ec2CostAnalysisRunRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  async upsertRecommendation(
    input: UpsertEc2CostRecommendationInput,
  ): Promise<Ec2CostRecommendationRecord> {
    const rec = input.recommendation;
    const pk = cloudResourceAccountPartitionKey(rec.tenantId, rec.accountId);
    const sk = ec2CostRecommendationSortKey({
      region: rec.region,
      category: rec.category,
      resourceId: rec.resourceId,
      ruleVersion: rec.ruleVersion,
    });
    const existing = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const now = new Date().toISOString();
    const prior = existing.Item as CostRecommendationItem | undefined;

    if (prior && prior.entityType === 'EC2_COST_RECOMMENDATION') {
      const updated: CostRecommendationItem = {
        ...prior,
        ...rec,
        recommendationId: prior.recommendationId,
        findingKey: input.findingKey,
        firstDetectedAt: prior.firstDetectedAt,
        lastDetectedAt: now,
        lifecycleStatus: mergeRecommendationLifecycleOnUpsert(
          prior,
          rec.lifecycleStatus,
        ),
        resolvedAt:
          prior.lifecycleStatus === 'RESOLVED' &&
          mergeRecommendationLifecycleOnUpsert(prior, rec.lifecycleStatus) === 'OPEN'
            ? undefined
            : prior.resolvedAt,
        version: prior.version + 1,
        updatedAt: now,
        pk,
        sk,
        entityType: 'EC2_COST_RECOMMENDATION',
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
          throw new RepositoryConflictError('EC2 cost recommendation version conflict.');
        }
        throw error;
      }
      return stripRecommendationKeys(updated);
    }

    const created: CostRecommendationItem = {
      ...(rec as Ec2CostRecommendationRecord),
      recommendationId: rec.recommendationId ?? `ec2rec-${randomUUID()}`,
      findingKey: input.findingKey,
      firstDetectedAt: rec.firstDetectedAt ?? now,
      lastDetectedAt: rec.lastDetectedAt ?? now,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lifecycleStatus: rec.lifecycleStatus ?? 'OPEN',
      pk,
      sk,
      entityType: 'EC2_COST_RECOMMENDATION',
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: created,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return stripRecommendationKeys(created);
  }

  async getRecommendationByScope(
    query: Ec2CostRecommendationScopeQuery,
  ): Promise<Ec2CostRecommendationRecord | null> {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const sk = ec2CostRecommendationSortKey({
      region: query.region,
      category: query.category,
      resourceId: query.resourceId,
      ruleVersion: query.ruleVersion,
    });
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const item = result.Item as CostRecommendationItem | undefined;
    if (!item || item.entityType !== 'EC2_COST_RECOMMENDATION') {
      return null;
    }
    if (item.tenantId !== query.tenantId) {
      return null;
    }
    return stripRecommendationKeys(item);
  }

  async getRecommendation(
    tenantId: string,
    accountId: string,
    recommendationId: string,
  ): Promise<Ec2CostRecommendationRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    let nextToken: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':prefix': EC2_COST_RECOMMENDATION_SK_PREFIX,
          },
          ExclusiveStartKey: nextToken,
        }),
      );
      for (const item of result.Items ?? []) {
        const rec = stripRecommendationKeys(item as CostRecommendationItem);
        if (rec.recommendationId === recommendationId) {
          return rec;
        }
      }
      nextToken = result.LastEvaluatedKey;
    } while (nextToken);
    return null;
  }

  async listRecommendations(
    query: Ec2CostRecommendationListQuery,
  ): Promise<PageResult<Ec2CostRecommendationRecord>> {
    const limit = normalizePageSize(query.limit);
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const startKey = decodeEc2CostRecommendationNextToken(query.nextToken, query);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': EC2_COST_RECOMMENDATION_SK_PREFIX,
        },
        ExclusiveStartKey: startKey,
        Limit: limit * 2,
      }),
    );
    let items = (result.Items ?? []).map((item) =>
      stripRecommendationKeys(item as CostRecommendationItem),
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
    const slice = items.slice(0, limit);
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextToken:
        slice.length === limit && last
          ? encodeEc2CostRecommendationNextToken(query, {
              pk,
              sk: ec2CostRecommendationSortKey({
                region: last.region,
                category: last.category,
                resourceId: last.resourceId,
                ruleVersion: last.ruleVersion,
              }),
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
    const keys: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.listRecommendations({
        tenantId,
        accountId,
        lifecycleStatus: 'OPEN',
        limit: 100,
        nextToken,
      });
      keys.push(...page.items.map((i) => i.findingKey));
      nextToken = page.nextToken;
    } while (nextToken);
    return keys;
  }

  async markResolved(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
    expectedVersion: number;
    resolvedAt: string;
  }): Promise<Ec2CostRecommendationRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    let target: CostRecommendationItem | undefined;
    let nextKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':prefix': EC2_COST_RECOMMENDATION_SK_PREFIX,
          },
          ExclusiveStartKey: nextKey,
        }),
      );
      for (const item of result.Items ?? []) {
        const rec = item as CostRecommendationItem;
        if (rec.findingKey === input.findingKey) {
          target = rec;
          break;
        }
      }
      if (target) {
        break;
      }
      nextKey = result.LastEvaluatedKey;
    } while (nextKey);

    if (!target) {
      throw new RepositoryNotFoundError('EC2 cost recommendation not found.');
    }
    if (target.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 cost recommendation version conflict.');
    }

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: target.pk, sk: target.sk },
          UpdateExpression:
            'SET lifecycleStatus = :ls, resolvedAt = :ra, #updatedAt = :ua, #version = #version + :one',
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: {
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':ls': 'RESOLVED',
            ':ra': input.resolvedAt,
            ':ua': input.resolvedAt,
            ':one': 1,
            ':expected': input.expectedVersion,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 cost recommendation version conflict.');
      }
      throw error;
    }
    const refreshed = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: target.pk, sk: target.sk } }),
    );
    return stripRecommendationKeys(refreshed.Item as CostRecommendationItem);
  }

  async createRun(input: CreateEc2CostAnalysisRunInput): Promise<Ec2CostAnalysisRunRecord> {
    const now = new Date().toISOString();
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2CostAnalysisRunSortKey(input.runId);
    const item: CostRunItem = {
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
      pk,
      sk,
      entityType: 'EC2_COST_ANALYSIS_RUN',
      executionOwnerId: input.executionOwnerId,
      leaseExpiresAt: input.leaseExpiresAt,
      attemptCount: input.attemptCount ?? 1,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return stripRunKeys(item);
  }

  async claimExecution(
    input: ClaimEc2CostAnalysisRunExecutionInput,
  ): Promise<Ec2CostAnalysisRunRecord> {
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
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2CostAnalysisRunSortKey(input.runId);
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
        throw new RepositoryConflictError('EC2 cost analysis run version conflict.');
      }
      throw error;
    }
    const refreshed = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    return stripRunKeys(refreshed.Item as CostRunItem);
  }

  async completeRun(input: CompleteEc2CostAnalysisRunInput): Promise<Ec2CostAnalysisRunRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2CostAnalysisRunSortKey(input.runId);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression:
            'SET #status = :status, completedAt = :completedAt, instancesFound = :ifound, instancesEvaluated = :ieval, recommendationsCreated = :rc, recommendationsUpdated = :ru, recommendationsResolved = :rr, insufficientDataCount = :idc, regionsSucceeded = :rs, regionsFailed = :rf, warnings = :warnings, #updatedAt = :updatedAt, #version = #version + :one, failureRetryable = :failureRetryable REMOVE executionOwnerId, leaseExpiresAt',
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':status': input.status,
            ':completedAt': input.completedAt,
            ':ifound': input.instancesFound,
            ':ieval': input.instancesEvaluated,
            ':rc': input.recommendationsCreated,
            ':ru': input.recommendationsUpdated,
            ':rr': input.recommendationsResolved,
            ':idc': input.insufficientDataCount,
            ':rs': input.regionsSucceeded,
            ':rf': input.regionsFailed,
            ':warnings': input.warnings,
            ':updatedAt': new Date().toISOString(),
            ':one': 1,
            ':expected': input.expectedVersion,
            ':failureRetryable':
              input.status === 'FAILED' ? (input.failureRetryable ?? true) : false,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 cost analysis run version conflict.');
      }
      throw error;
    }
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    return stripRunKeys(result.Item as CostRunItem);
  }

  async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2CostAnalysisRunRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const sk = ec2CostAnalysisRunSortKey(runId);
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    if (!result.Item) {
      return null;
    }
    return stripRunKeys(result.Item as CostRunItem);
  }
}

function stripRecommendationKeys(item: CostRecommendationItem): Ec2CostRecommendationRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...record } = item;
  return record;
}

function stripRunKeys(item: CostRunItem): Ec2CostAnalysisRunRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...record } = item;
  return record;
}
