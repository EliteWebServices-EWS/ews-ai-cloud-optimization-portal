import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  cloudResourceSortKey,
  cloudResourceSortKeyPrefixForAccount,
  cloudResourceSortKeyPrefixForType,
  ec2DiscoveryRunSortKey,
  EC2_DISCOVERY_RUN_SK_PREFIX,
  RepositoryConflictError,
  RepositoryNotFoundError,
  isConditionalCheckFailure,
} from '../../database';

import {
  decodeEc2ResourceListNextToken,
  encodeEc2ResourceListNextToken,
} from '../ec2-cloud-resource-pagination';

import type {
  CompleteEc2DiscoveryRunInput,
  CreateEc2DiscoveryRunInput,
  Ec2CloudResourceRepository,
  Ec2DiscoveryRunRepository,
  Ec2ResourceListQuery,
  UpsertDiscoveredCloudResourceInput,
} from '../contracts/ec2-cloud-resource-repository';
import type {
  DiscoveredCloudResourceRecord,
  Ec2DiscoveryRunRecord,
} from '../models/cloud-resource-persistence-models';
import { CLOUD_INTELLIGENCE_SERVICE_EC2 } from '../models/cloud-resource-persistence-models';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface CloudResourceItem extends DiscoveredCloudResourceRecord {
  pk: string;
  sk: string;
  entityType: 'CLOUD_RESOURCE';
}

interface DiscoveryRunItem extends Ec2DiscoveryRunRecord {
  pk: string;
  sk: string;
  entityType: 'EC2_DISCOVERY_RUN';
}

function isRunItem(sk: string): boolean {
  return sk.startsWith(EC2_DISCOVERY_RUN_SK_PREFIX);
}

export class DynamoDbEc2CloudResourceRepository
  extends BaseDynamoDbRepository
  implements Ec2CloudResourceRepository, Ec2DiscoveryRunRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  async upsertDiscoveredResource(
    input: UpsertDiscoveredCloudResourceInput,
  ): Promise<DiscoveredCloudResourceRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = cloudResourceSortKey(input.region, input.resourceType, input.resourceId);
    const existing = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const now = new Date().toISOString();
    const prior = existing.Item as CloudResourceItem | undefined;

    if (prior && prior.entityType === 'CLOUD_RESOURCE') {
      const updated: CloudResourceItem = {
        ...prior,
        arn: input.arn ?? prior.arn,
        name: input.name ?? prior.name,
        tags: input.tags,
        metadata: input.metadata,
        status: input.status,
        discoveredAt: input.discoveredAt,
        lastSeenAt: input.discoveredAt,
        version: prior.version + 1,
        updatedAt: now,
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
          throw new RepositoryConflictError('EC2 cloud resource version conflict.');
        }
        throw error;
      }
      return stripItemKeys(updated);
    }

    const created: CloudResourceItem = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      service: CLOUD_INTELLIGENCE_SERVICE_EC2,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      arn: input.arn,
      name: input.name,
      tags: input.tags,
      discoveredAt: input.discoveredAt,
      firstSeenAt: input.discoveredAt,
      lastSeenAt: input.discoveredAt,
      status: input.status,
      version: 1,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
      pk,
      sk,
      entityType: 'CLOUD_RESOURCE',
    };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: created,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 cloud resource version conflict.');
      }
      throw error;
    }
    return stripItemKeys(created);
  }

  async getResource(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: DiscoveredCloudResourceRecord['resourceType'];
    resourceId: string;
  }): Promise<DiscoveredCloudResourceRecord | null> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = cloudResourceSortKey(input.region, input.resourceType, input.resourceId);
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const item = result.Item as CloudResourceItem | undefined;
    if (!item || item.entityType !== 'CLOUD_RESOURCE') {
      return null;
    }
    return stripItemKeys(item);
  }

  async listResources(query: Ec2ResourceListQuery): Promise<PageResult<DiscoveredCloudResourceRecord>> {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const prefix =
      query.region && query.resourceType
        ? cloudResourceSortKeyPrefixForType(query.region, query.resourceType)
        : cloudResourceSortKeyPrefixForAccount();

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
        Limit: normalizePageSize(query.limit),
        ExclusiveStartKey: decodeEc2ResourceListNextToken(query.nextToken, query),
      }),
    );

    let items = (result.Items ?? [])
      .filter((item) => !isRunItem(String(item.sk)))
      .map((item) => stripItemKeys(item as CloudResourceItem));

    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }

    return {
      items,
      nextToken: encodeEc2ResourceListNextToken(query, result.LastEvaluatedKey),
    };
  }

  async listResourcesInScope(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: DiscoveredCloudResourceRecord['resourceType'];
  }): Promise<DiscoveredCloudResourceRecord[]> {
    const page = await this.listResources({
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      resourceType: input.resourceType,
      limit: 100,
    });
    return page.items;
  }

  async markNotSeen(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: DiscoveredCloudResourceRecord['resourceType'];
    resourceId: string;
    expectedVersion: number;
  }): Promise<DiscoveredCloudResourceRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = cloudResourceSortKey(input.region, input.resourceType, input.resourceId);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression:
            'SET #status = :status, #updatedAt = :updatedAt, #version = #version + :one',
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':status': 'NOT_SEEN',
            ':updatedAt': new Date().toISOString(),
            ':one': 1,
            ':expected': input.expectedVersion,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 cloud resource version conflict.');
      }
      throw error;
    }
    const refreshed = await this.getResource(input);
    if (!refreshed) {
      throw new RepositoryNotFoundError('EC2 cloud resource not found.');
    }
    return refreshed;
  }

  async getLatestSuccessfulRun(
    tenantId: string,
    accountId: string,
  ): Promise<Ec2DiscoveryRunRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': EC2_DISCOVERY_RUN_SK_PREFIX },
      }),
    );
    const runs = (result.Items ?? [])
      .map((item) => stripRunKeys(item as DiscoveryRunItem))
      .filter((run) => run.status === 'SUCCEEDED' || run.status === 'PARTIAL')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return runs[0] ?? null;
  }

  async createRun(input: CreateEc2DiscoveryRunInput): Promise<Ec2DiscoveryRunRecord> {
    const now = new Date().toISOString();
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2DiscoveryRunSortKey(input.runId);
    const item: DiscoveryRunItem = {
      runId: input.runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      requestedRegions: input.requestedRegions,
      startedAt: input.startedAt,
      status: 'RUNNING',
      resourceCounts: {},
      regionsSucceeded: [],
      regionsFailed: [],
      warnings: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      pk,
      sk,
      entityType: 'EC2_DISCOVERY_RUN',
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

  async completeRun(input: CompleteEc2DiscoveryRunInput): Promise<Ec2DiscoveryRunRecord> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = ec2DiscoveryRunSortKey(input.runId);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression:
            'SET #status = :status, completedAt = :completedAt, resourceCounts = :counts, regionsSucceeded = :rs, regionsFailed = :rf, warnings = :warnings, #updatedAt = :updatedAt, #version = #version + :one',
          ConditionExpression: '#version = :expected',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':status': input.status,
            ':completedAt': input.completedAt,
            ':counts': input.resourceCounts,
            ':rs': input.regionsSucceeded,
            ':rf': input.regionsFailed,
            ':warnings': input.warnings,
            ':updatedAt': new Date().toISOString(),
            ':one': 1,
            ':expected': input.expectedVersion,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError('EC2 discovery run version conflict.');
      }
      throw error;
    }
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    return stripRunKeys(result.Item as DiscoveryRunItem);
  }

  async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2DiscoveryRunRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const sk = ec2DiscoveryRunSortKey(runId);
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    if (!result.Item) {
      return null;
    }
    return stripRunKeys(result.Item as DiscoveryRunItem);
  }
}

function stripItemKeys(item: CloudResourceItem): DiscoveredCloudResourceRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...record } = item;
  return record;
}

function stripRunKeys(item: DiscoveryRunItem): Ec2DiscoveryRunRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...record } = item;
  return record;
}
