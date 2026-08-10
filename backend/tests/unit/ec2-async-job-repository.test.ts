import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EC2_ASYNC_JOB_TYPE, buildEc2AsyncJobRequestFingerprint } from '../../database/async-jobs';
import {
  RepositoryConflictError,
  RepositoryIdempotencyConflictError,
} from '../../database';
import type { CreateEc2AsyncJobInput } from '../../repositories/contracts/ec2-async-job-repository';
import { MockEc2AsyncJobRepository } from '../../repositories/mock/mock-ec2-async-job-repository';
import { deriveIdempotentAsyncJobId } from '../../shared/utils/response';

const TENANT_A = 'tenant-async-a';
const TENANT_B = 'tenant-async-b';
const ACCOUNT = '111122223333';

function createInput(
  overrides: Partial<CreateEc2AsyncJobInput> = {},
): CreateEc2AsyncJobInput {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const idempotencyKey = overrides.idempotencyKey ?? 'idem-key-1';
  const regions = overrides.regions ?? ['us-east-1'];
  const accountId = overrides.accountId ?? ACCOUNT;
  const jobId =
    overrides.jobId ?? deriveIdempotentAsyncJobId(tenantId, idempotencyKey);
  const requestFingerprint =
    overrides.requestFingerprint ??
    buildEc2AsyncJobRequestFingerprint({
      accountId,
      regions,
      jobType: EC2_ASYNC_JOB_TYPE,
    });

  return {
    tenantId,
    jobId,
    accountId,
    regions,
    jobType: EC2_ASYNC_JOB_TYPE,
    correlationId: overrides.correlationId ?? 'corr-1',
    idempotencyKey,
    requestFingerprint,
    ...overrides,
  };
}

describe('MockEc2AsyncJobRepository', () => {
  it('creates a job with initial lifecycle fields', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const input = createInput();
    const job = await repo.createIdempotentJob(input);

    assert.equal(job.tenantId, TENANT_A);
    assert.equal(job.jobId, input.jobId);
    assert.equal(job.status, 'QUEUED');
    assert.equal(job.queueStatus, 'PENDING');
    assert.equal(job.stage, 'ENQUEUE');
    assert.equal(job.version, 1);
    assert.deepEqual(job.regions, ['us-east-1']);
  });

  it('gets a job within tenant scope', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const created = await repo.createIdempotentJob(createInput());
    const loaded = await repo.getJob(TENANT_A, created.jobId);
    assert.ok(loaded);
    assert.equal(loaded.jobId, created.jobId);
    assert.deepEqual(loaded, created);
  });

  it('lists jobs by tenant with pagination', async () => {
    const repo = new MockEc2AsyncJobRepository();
    await repo.createIdempotentJob(createInput({ idempotencyKey: 'k1', jobId: 'job-1' }));
    await repo.createIdempotentJob(createInput({ idempotencyKey: 'k2', jobId: 'job-2' }));
    await repo.createIdempotentJob(
      createInput({ tenantId: TENANT_B, idempotencyKey: 'k3', jobId: 'job-b' }),
    );

    const page = await repo.listJobsByTenant(TENANT_A, { limit: 1 });
    assert.equal(page.items.length, 1);
    assert.ok(page.nextToken);

    const allA = await repo.listJobsByTenant(TENANT_A);
    assert.equal(allA.items.length, 2);
    assert.equal(allA.items.every((j) => j.tenantId === TENANT_A), true);
  });

  it('enforces cross-tenant isolation on get and list', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const job = await repo.createIdempotentJob(createInput());
    assert.equal(await repo.getJob(TENANT_B, job.jobId), undefined);

    const listB = await repo.listJobsByTenant(TENANT_B);
    assert.equal(listB.items.length, 0);
  });

  it('rejects optimistic locking when expected version is stale', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const job = await repo.createIdempotentJob(createInput());
    await repo.updateJob(
      TENANT_A,
      job.jobId,
      { queueStatus: 'ENQUEUED' },
      { expectedVersion: job.version },
    );
    await assert.rejects(
      () =>
        repo.updateJob(
          TENANT_A,
          job.jobId,
          { queueStatus: 'ENQUEUED' },
          { expectedVersion: job.version },
        ),
      RepositoryConflictError,
    );
  });

  it('returns the same job for idempotent same key and same payload', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const input = createInput();
    const first = await repo.createIdempotentJob(input);
    const second = await repo.createIdempotentJob(input);
    assert.equal(first.jobId, second.jobId);
    assert.equal(first.version, second.version);
  });

  it('conflicts when idempotency key is reused with a different payload', async () => {
    const repo = new MockEc2AsyncJobRepository();
    await repo.createIdempotentJob(createInput({ idempotencyKey: 'shared-key' }));
    await assert.rejects(
      () =>
        repo.createIdempotentJob(
          createInput({
            idempotencyKey: 'shared-key',
            regions: ['eu-west-1'],
            requestFingerprint: buildEc2AsyncJobRequestFingerprint({
              accountId: ACCOUNT,
              regions: ['eu-west-1'],
              jobType: EC2_ASYNC_JOB_TYPE,
            }),
          }),
        ),
      RepositoryIdempotencyConflictError,
    );
  });

  it('creates a new job for a new idempotency key', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const first = await repo.createIdempotentJob(createInput({ idempotencyKey: 'key-a' }));
    const second = await repo.createIdempotentJob(createInput({ idempotencyKey: 'key-b' }));
    assert.notEqual(first.jobId, second.jobId);
  });

  it('records status history events on create and append', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const job = await repo.createIdempotentJob(createInput());
    await repo.appendEvent({
      tenantId: TENANT_A,
      jobId: job.jobId,
      eventType: 'ec2.async_job.enqueued',
      correlationId: 'corr-2',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      stage: 'ENQUEUE',
    });

    const events = await repo.listEvents(TENANT_A, job.jobId);
    assert.equal(events.items.length, 2);
    assert.equal(events.items[0]?.eventType, 'ec2.async_job.created');
    assert.equal(events.items[1]?.eventType, 'ec2.async_job.enqueued');
  });

  it('findNewestActiveJobByRequestFingerprint returns active job for matching scope', async () => {
    const repo = new MockEc2AsyncJobRepository();
    const fingerprint = buildEc2AsyncJobRequestFingerprint({
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      jobType: EC2_ASYNC_JOB_TYPE,
    });
    const completed = await repo.createIdempotentJob(
      createInput({ idempotencyKey: 'done-key', jobId: 'job-done' }),
    );
    await repo.updateJob(
      TENANT_A,
      completed.jobId,
      { status: 'SUCCEEDED', stage: 'COMPLETE', completedAt: new Date().toISOString() },
      { expectedVersion: completed.version },
    );
    const active = await repo.createIdempotentJob(
      createInput({ idempotencyKey: 'active-key', jobId: 'job-active' }),
    );
    await repo.updateJob(
      TENANT_A,
      active.jobId,
      { status: 'RUNNING', stage: 'DISCOVERY' },
      { expectedVersion: active.version },
    );
    const found = await repo.findNewestActiveJobByRequestFingerprint(TENANT_A, fingerprint);
    assert.equal(found?.jobId, 'job-active');
  });
});
