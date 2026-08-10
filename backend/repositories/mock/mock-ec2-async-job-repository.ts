import { randomUUID } from 'node:crypto';

import {
  RepositoryConflictError,
  RepositoryIdempotencyConflictError,
} from '../../database';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import type {
  AppendEc2AsyncJobEventInput,
  CreateEc2AsyncJobInput,
  Ec2AsyncJobRepository,
  UpdateEc2AsyncJobInput,
} from '../contracts/ec2-async-job-repository';
import type {
  Ec2AsyncJobEventRecord,
  Ec2AsyncJobRecord,
} from '../../async-jobs/ec2-async-job-models';
import { isEc2AsyncJobActive } from '../../services/ec2-async-job-active';

function jobKey(tenantId: string, jobId: string): string {
  return `${tenantId}#${jobId}`;
}

export class MockEc2AsyncJobRepository implements Ec2AsyncJobRepository {
  private readonly jobs = new Map<string, Ec2AsyncJobRecord>();
  private readonly idempotency = new Map<string, { jobId: string; requestFingerprint: string }>();
  private readonly events = new Map<string, Ec2AsyncJobEventRecord[]>();
  private readonly createLocks = new Map<string, Promise<Ec2AsyncJobRecord>>();

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

  async getIdempotencyJobId(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ jobId: string; requestFingerprint: string } | undefined> {
    return this.idempotency.get(`${tenantId}#${idempotencyKey}`);
  }

  async createIdempotentJob(input: CreateEc2AsyncJobInput): Promise<Ec2AsyncJobRecord> {
    const lockKey = `${input.tenantId}#${input.idempotencyKey}`;
    const inFlight = this.createLocks.get(lockKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.createIdempotentJobInternal(input);
    this.createLocks.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      this.createLocks.delete(lockKey);
    }
  }

  private async createIdempotentJobInternal(
    input: CreateEc2AsyncJobInput,
  ): Promise<Ec2AsyncJobRecord> {
    const idemKey = `${input.tenantId}#${input.idempotencyKey}`;
    const existingIdem = this.idempotency.get(idemKey);
    if (existingIdem) {
      if (existingIdem.requestFingerprint !== input.requestFingerprint) {
        throw new RepositoryIdempotencyConflictError();
      }
      const existingJob = this.jobs.get(jobKey(input.tenantId, existingIdem.jobId));
      if (existingJob) {
        return existingJob;
      }
    }

    const key = jobKey(input.tenantId, input.jobId);
    if (this.jobs.has(key)) {
      const job = this.jobs.get(key)!;
      if (job.requestFingerprint !== input.requestFingerprint) {
        throw new RepositoryIdempotencyConflictError();
      }
      return job;
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

    this.jobs.set(key, record);
    this.idempotency.set(idemKey, {
      jobId: input.jobId,
      requestFingerprint: input.requestFingerprint,
    });
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
    const job = this.jobs.get(jobKey(tenantId, jobId));
    if (!job || job.tenantId !== tenantId) {
      return undefined;
    }
    return job;
  }

  async updateJob(
    tenantId: string,
    jobId: string,
    changes: UpdateEc2AsyncJobInput,
    options: { expectedVersion: number },
  ): Promise<Ec2AsyncJobRecord> {
    const key = jobKey(tenantId, jobId);
    const existing = this.jobs.get(key);
    if (!existing) {
      throw new RepositoryConflictError('Job not found.');
    }
    if (existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError();
    }
    const updated: Ec2AsyncJobRecord = {
      ...existing,
      ...changes,
      regions: existing.regions,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(key, updated);
    return updated;
  }

  async listJobsByTenant(
    tenantId: string,
    page?: { limit?: number; nextToken?: string },
  ): Promise<PageResult<Ec2AsyncJobRecord>> {
    const limit = normalizePageSize(page?.limit);
    let items = [...this.jobs.values()]
      .filter((job) => job.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.jobId.localeCompare(a.jobId));

    let startIndex = 0;
    if (page?.nextToken) {
      const token = JSON.parse(Buffer.from(page.nextToken, 'base64url').toString('utf8')) as {
        tenantId: string;
        startIndex: number;
      };
      if (token.tenantId !== tenantId) {
        throw new Error('Invalid pagination token scope.');
      }
      startIndex = token.startIndex;
    }

    const slice = items.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + slice.length;
    const nextToken =
      nextIndex < items.length
        ? Buffer.from(
            JSON.stringify({ tenantId, startIndex: nextIndex }),
            'utf8',
          ).toString('base64url')
        : undefined;

    return { items: slice, nextToken };
  }

  async appendEvent(input: AppendEc2AsyncJobEventInput): Promise<Ec2AsyncJobEventRecord> {
    const event: Ec2AsyncJobEventRecord = {
      tenantId: input.tenantId,
      jobId: input.jobId,
      eventId: randomUUID(),
      eventType: input.eventType,
      timestamp: new Date().toISOString(),
      correlationId: input.correlationId,
      status: input.status,
      queueStatus: input.queueStatus,
      stage: input.stage,
      errorSummary: input.errorSummary,
    };
    const key = jobKey(input.tenantId, input.jobId);
    const list = this.events.get(key) ?? [];
    list.push(event);
    this.events.set(key, list);
    return event;
  }

  async listEvents(
    tenantId: string,
    jobId: string,
    page?: { limit?: number; nextToken?: string },
  ): Promise<PageResult<Ec2AsyncJobEventRecord>> {
    const limit = normalizePageSize(page?.limit);
    const key = jobKey(tenantId, jobId);
    let items = [...(this.events.get(key) ?? [])].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    let startIndex = 0;
    if (page?.nextToken) {
      startIndex = Number.parseInt(page.nextToken, 10);
      if (Number.isNaN(startIndex)) {
        throw new Error('Invalid pagination token.');
      }
    }

    const slice = items.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + slice.length;
    return {
      items: slice,
      nextToken: nextIndex < items.length ? String(nextIndex) : undefined,
    };
  }
}
