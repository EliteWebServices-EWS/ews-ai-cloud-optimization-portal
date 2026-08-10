import { randomUUID } from 'node:crypto';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  asyncJobEventSortKey,
  asyncJobIdempotencySortKey,
  asyncJobSortKey,
  asyncJobTenantListIndexPartitionKey,
  asyncJobTenantListIndexSortKey,
  tenantPartitionKey,
} from '../../database';
import {
  RepositoryConflictError,
  RepositoryIdempotencyConflictError,
  decodeNextToken,
  encodeNextToken,
  isConditionalCheckFailure,
} from '../../database';
import type {
  AppendEc2AsyncJobEventInput,
  CreateEc2AsyncJobInput,
  Ec2AsyncJobRepository,
  UpdateEc2AsyncJobInput,
} from '../contracts/ec2-async-job-repository';
import type { PageRequest, PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import type {
  Ec2AsyncJobEventRecord,
  Ec2AsyncJobRecord,
} from '../../async-jobs/ec2-async-job-models';
import { isEc2AsyncJobActive } from '../../services/ec2-async-job-active';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';

type JobItem = Ec2AsyncJobRecord & {
  pk: string;
  sk: string;
  entityType: 'EC2_ASYNC_JOB';
  gsi1pk: string;
  gsi1sk: string;
};

type IdempotencyItem = {
  pk: string;
  sk: string;
  entityType: 'EC2_ASYNC_JOB_IDEM';
  tenantId: string;
  idempotencyKey: string;
  jobId: string;
  requestFingerprint: string;
  createdAt: string;
};

type EventItem = Ec2AsyncJobEventRecord & {
  pk: string;
  sk: string;
  entityType: 'EC2_ASYNC_JOB_EVENT';
};

function toJobRecord(item: JobItem): Ec2AsyncJobRecord {
  const {
    pk: _pk,
    sk: _sk,
    entityType: _entityType,
    gsi1pk: _gsi1pk,
    gsi1sk: _gsi1sk,
    ...record
  } = item;
  return record;
}

export class DynamoDbEc2AsyncJobRepository
  extends BaseDynamoDbRepository
  implements Ec2AsyncJobRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  async getIdempotencyJobId(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ jobId: string; requestFingerprint: string } | undefined> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: asyncJobIdempotencySortKey(idempotencyKey),
        },
      }),
    );
    const item = response.Item as IdempotencyItem | undefined;
    if (!item) {
      return undefined;
    }
    return { jobId: item.jobId, requestFingerprint: item.requestFingerprint };
  }

  async createIdempotentJob(input: CreateEc2AsyncJobInput): Promise<Ec2AsyncJobRecord> {
    const existingIdem = await this.getIdempotencyJobId(input.tenantId, input.idempotencyKey);
    if (existingIdem) {
      if (existingIdem.requestFingerprint !== input.requestFingerprint) {
        throw new RepositoryIdempotencyConflictError();
      }
      const existingJob = await this.getJob(input.tenantId, existingIdem.jobId);
      if (existingJob) {
        return existingJob;
      }
    }

    const now = new Date().toISOString();
    const record: Ec2AsyncJobRecord = {
      tenantId: input.tenantId,
      jobId: input.jobId,
      accountId: input.accountId,
      regions: [...input.regions],
      jobType: input.jobType,
      status: 'QUEUED',
      queueStatus: 'PENDING',
      stage: 'ENQUEUE',
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      retryCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const jobItem: JobItem = {
      ...record,
      pk: tenantPartitionKey(record.tenantId),
      sk: asyncJobSortKey(record.jobId),
      entityType: 'EC2_ASYNC_JOB',
      gsi1pk: asyncJobTenantListIndexPartitionKey(record.tenantId),
      gsi1sk: asyncJobTenantListIndexSortKey(record.createdAt, record.jobId),
    };

    const idemItem: IdempotencyItem = {
      pk: tenantPartitionKey(input.tenantId),
      sk: asyncJobIdempotencySortKey(input.idempotencyKey),
      entityType: 'EC2_ASYNC_JOB_IDEM',
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      jobId: input.jobId,
      requestFingerprint: input.requestFingerprint,
      createdAt: now,
    };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: jobItem,
                ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: idemItem,
                ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const replay = await this.getIdempotencyJobId(input.tenantId, input.idempotencyKey);
        if (replay) {
          if (replay.requestFingerprint !== input.requestFingerprint) {
            throw new RepositoryIdempotencyConflictError();
          }
          const job = await this.getJob(input.tenantId, replay.jobId);
          if (job) {
            return job;
          }
        }
        throw new RepositoryConflictError();
      }
      throw error;
    }

    await this.appendEvent({
      tenantId: input.tenantId,
      jobId: input.jobId,
      eventType: 'ec2.async_job.created',
      correlationId: input.correlationId,
      status: record.status,
      queueStatus: record.queueStatus,
      stage: record.stage,
    });

    return record;
  }

  async getJob(tenantId: string, jobId: string): Promise<Ec2AsyncJobRecord | undefined> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: asyncJobSortKey(jobId),
        },
      }),
    );
    if (!response.Item) {
      return undefined;
    }
    return toJobRecord(response.Item as JobItem);
  }

  async updateJob(
    tenantId: string,
    jobId: string,
    changes: UpdateEc2AsyncJobInput,
    options: { expectedVersion: number },
  ): Promise<Ec2AsyncJobRecord> {
    const names: Record<string, string> = {
      '#version': 'version',
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, unknown> = {
      ':expectedVersion': options.expectedVersion,
      ':nextVersion': options.expectedVersion + 1,
      ':updatedAt': new Date().toISOString(),
    };
    const sets: string[] = ['#version = :nextVersion', '#updatedAt = :updatedAt'];

    for (const [field, value] of Object.entries(changes) as Array<
      [keyof UpdateEc2AsyncJobInput, unknown]
    >) {
      if (value === undefined) {
        continue;
      }
      names[`#${field}`] = field;
      values[`:${field}`] = value;
      sets.push(`#${field} = :${field}`);
    }

    try {
      const response = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: asyncJobSortKey(jobId),
          },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: '#version = :expectedVersion',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return toJobRecord(response.Attributes as JobItem);
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError();
      }
      throw error;
    }
  }

  async listJobsByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<Ec2AsyncJobRecord>> {
    const limit = normalizePageSize(page?.limit);
    const exclusiveStartKey = page?.nextToken ? decodeNextToken(page.nextToken) : undefined;

    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': asyncJobTenantListIndexPartitionKey(tenantId),
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (response.Items ?? []).map((item) => toJobRecord(item as JobItem));
    return {
      items,
      nextToken: encodeNextToken(response.LastEvaluatedKey),
    };
  }

  async findNewestActiveJobByRequestFingerprint(
    tenantId: string,
    requestFingerprint: string,
  ): Promise<Ec2AsyncJobRecord | undefined> {
    let nextToken: string | undefined;
    do {
      const page = await this.listJobsByTenant(tenantId, { limit: 50, nextToken });
      for (const job of page.items) {
        if (
          job.requestFingerprint === requestFingerprint &&
          isEc2AsyncJobActive(job)
        ) {
          return job;
        }
      }
      nextToken = page.nextToken;
    } while (nextToken);
    return undefined;
  }

  async appendEvent(input: AppendEc2AsyncJobEventInput): Promise<Ec2AsyncJobEventRecord> {
    const eventId = randomUUID();
    const timestamp = new Date().toISOString();
    const event: Ec2AsyncJobEventRecord = {
      tenantId: input.tenantId,
      jobId: input.jobId,
      eventId,
      eventType: input.eventType,
      timestamp,
      correlationId: input.correlationId,
      status: input.status,
      queueStatus: input.queueStatus,
      stage: input.stage,
      errorSummary: input.errorSummary,
    };
    const item: EventItem = {
      ...event,
      pk: tenantPartitionKey(input.tenantId),
      sk: asyncJobEventSortKey(input.jobId, eventId),
      entityType: 'EC2_ASYNC_JOB_EVENT',
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );
    return event;
  }

  async listEvents(
    tenantId: string,
    jobId: string,
    page?: PageRequest,
  ): Promise<PageResult<Ec2AsyncJobEventRecord>> {
    const limit = normalizePageSize(page?.limit);
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':skPrefix': `ASYNC_JOB#${jobId}#EVENT#`,
        },
        Limit: limit,
        ExclusiveStartKey: page?.nextToken ? decodeNextToken(page.nextToken) : undefined,
      }),
    );

    const items = (response.Items ?? []).map((item) => {
      const {
        pk: _pk,
        sk: _sk,
        entityType: _entityType,
        ...event
      } = item as EventItem;
      return event;
    });

    return {
      items,
      nextToken: encodeNextToken(response.LastEvaluatedKey),
    };
  }
}
