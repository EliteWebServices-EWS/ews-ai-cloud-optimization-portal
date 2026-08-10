import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createEc2AsyncJobRoutes } from '../../api/routes/ec2-async-job.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
  type TenantRole,
} from '../../auth';
import { MockEc2IntelligenceQueueSender } from '../../async-jobs/ec2-intelligence-queue-sender';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2AsyncJobRepository } from '../../repositories/mock/mock-ec2-async-job-repository';
import { Ec2AsyncJobApiService } from '../../services/ec2-async-job-api-service';
import { Ec2AsyncJobProducerService } from '../../services/ec2-async-job-producer-service';
import { deriveIdempotentAsyncJobId } from '../../shared/utils/response';
import { assertNoSensitiveFields } from './ec2-cost-api-http.helpers';
import {
  httpJson,
  identityHeaders,
  seedMembership,
  seedVerifiedAccount,
  type TestIdentity,
} from './ec2-discovery-http.helpers';

const TENANT_A = 'tenant-ec2-async-a';
const TENANT_B = 'tenant-ec2-async-b';
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '222233334444';
const START_PATH = '/api/v1/analysis/ec2/start';

function groupsForRole(role: TenantRole): string {
  if (role === TENANT_ROLES.ANALYST) {
    return 'analyst';
  }
  if (role === TENANT_ROLES.VIEWER || role === TENANT_ROLES.AUDITOR) {
    return 'viewer';
  }
  return 'admin';
}

function identity(tenantId: string, role: TenantRole, userId = 'async-user'): TestIdentity {
  return {
    tenantId,
    userId,
    authenticated: true,
    groups: [groupsForRole(role)],
  };
}

async function httpWithIdempotency(
  baseUrl: string,
  method: string,
  path: string,
  id: TestIdentity,
  idempotencyKey: string | undefined,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    ...identityHeaders(id),
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

function data(body: Record<string, unknown>): Record<string, unknown> {
  return (body.data as Record<string, unknown>) ?? {};
}

function errorCode(body: Record<string, unknown>): string {
  const err = body.error as Record<string, unknown> | undefined;
  return (err?.code as string) ?? '';
}

describe('EC2 async job API HTTP', () => {
  let baseUrl: string;
  let server: import('node:http').Server;
  let awsAccounts: MockAwsAccountRepository;
  let jobs: MockEc2AsyncJobRepository;
  let queue: MockEc2IntelligenceQueueSender;
  let membershipRepository: InMemoryMembershipRepository;

  before(async () => {
    awsAccounts = new MockAwsAccountRepository();
    jobs = new MockEc2AsyncJobRepository();
    queue = new MockEc2IntelligenceQueueSender();
    membershipRepository = new InMemoryMembershipRepository();
    await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
    await seedVerifiedAccount(awsAccounts, TENANT_B, ACCOUNT_B, 'us-east-1');

    const producer = new Ec2AsyncJobProducerService(awsAccounts, jobs, queue);
    const api = new Ec2AsyncJobApiService(jobs);
    const app = express();
    app.use(express.json());
    app.use(createIdentitySourceMiddleware('lambda-adapter'));
    app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
    app.use(requireTenantContext());
    app.use(
      '/api/v1',
      createEc2AsyncJobRoutes({
        ec2AsyncJobProducer: producer,
        ec2AsyncJobApi: api,
        membershipRepository,
      }),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function seedAdmin(tenantId = TENANT_A, userId = 'async-admin') {
    await seedMembership(membershipRepository, tenantId, userId, TENANT_ROLES.TENANT_ADMIN);
    return identity(tenantId, TENANT_ROLES.TENANT_ADMIN, userId);
  }

  it('returns 202 after successful enqueue', async () => {
    const id = await seedAdmin(TENANT_A, 'start-202');
    const res = await httpWithIdempotency(
      baseUrl,
      'POST',
      START_PATH,
      id,
      'idem-202',
      { accountId: ACCOUNT_A, regions: ['us-east-1'] },
    );
    assert.equal(res.status, 202);
    assert.equal(data(res.body).queueStatus, 'ENQUEUED');
    assert.equal(queue.sent.length, 1);
    assertNoSensitiveFields(res.body);
    for (const message of queue.sent) {
      assertNoSensitiveFields(message as unknown as Record<string, unknown>);
      assert.equal(message.jobType, 'EC2_INTELLIGENCE');
      assert.doesNotMatch(JSON.stringify(message), /roleArn|externalId|AssumeRole/i);
    }
  });

  it('requires Idempotency-Key', async () => {
    const id = await seedAdmin(TENANT_A, 'no-idem');
    const res = await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, undefined, {
      accountId: ACCOUNT_A,
    });
    assert.equal(res.status, 422);
    assert.match(errorCode(res.body), /INVALID_REQUEST/);
  });

  it('returns 404 for unknown account and cross-tenant account', async () => {
    const id = await seedAdmin(TENANT_A, 'acct-404');
    assert.equal(
      (
        await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-missing', {
          accountId: '999988887777',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-other-tenant', {
          accountId: ACCOUNT_B,
        })
      ).status,
      404,
    );
  });

  it('returns 409 for unverified account and 422 for malformed body', async () => {
    const id = await seedAdmin(TENANT_A, 'acct-val');
    await awsAccounts.create({
      tenantId: TENANT_A,
      accountId: '333344445555',
      roleArn: 'arn:aws:iam::333344445555:role/SisumReadOnlyIntegrationRole',
      externalId: 'ext-test-value-never-logged',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: {},
    });
    assert.equal(
      (
        await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-pending', {
          accountId: '333344445555',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-bad-body', {
          accountId: ACCOUNT_A,
          tenantId: TENANT_A,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-bad-region', {
          accountId: ACCOUNT_A,
          regions: ['not-a-region'],
        })
      ).status,
      422,
    );
  });

  it('does not return 202 when enqueue fails; persists ENQUEUE_FAILED and retries with same key', async () => {
    const id = await seedAdmin(TENANT_A, 'enqueue-fail');
    queue.failNext = true;
    const failed = await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-fail', {
      accountId: ACCOUNT_A,
      regions: ['us-west-2'],
    });
    assert.notEqual(failed.status, 202);
    assert.equal(errorCode(failed.body), 'EC2_ASYNC_JOB_ENQUEUE_FAILED');

    const jobId = deriveIdempotentAsyncJobId(TENANT_A, 'idem-fail');
    const jobRes = await httpJson(
      baseUrl,
      'GET',
      `/api/v1/analysis/jobs/${jobId}`,
      id,
    );
    assert.equal(jobRes.status, 200);
    assert.equal(data(jobRes.body).queueStatus, 'ENQUEUE_FAILED');

    queue.failNext = false;
    const retry = await httpWithIdempotency(baseUrl, 'POST', START_PATH, id, 'idem-fail', {
      accountId: ACCOUNT_A,
      regions: ['us-west-2'],
    });
    assert.equal(retry.status, 202);
    assert.equal(data(retry.body).queueStatus, 'ENQUEUED');
  });

  it('supports GET job, list, and events with cross-tenant job isolation', async () => {
    const adminA = await seedAdmin(TENANT_A, 'read-a');
    const adminB = await seedAdmin(TENANT_B, 'read-b');
    const started = await httpWithIdempotency(
      baseUrl,
      'POST',
      START_PATH,
      adminA,
      'idem-read',
      { accountId: ACCOUNT_A },
    );
    assert.equal(started.status, 202);
    const jobId = data(started.body).jobId as string;

    const job = await httpJson(baseUrl, 'GET', `/api/v1/analysis/jobs/${jobId}`, adminA);
    assert.equal(job.status, 200);
    assert.equal(data(job.body).jobId, jobId);
    assertNoSensitiveFields(job.body);

    const list = await httpJson(baseUrl, 'GET', '/api/v1/analysis/jobs', adminA);
    assert.equal(list.status, 200);
    const items = data(list.body).items as Record<string, unknown>[];
    assert.ok(items.some((item) => item.jobId === jobId));

    const events = await httpJson(
      baseUrl,
      'GET',
      `/api/v1/analysis/jobs/${jobId}/events`,
      adminA,
    );
    assert.equal(events.status, 200);
    const eventItems = data(events.body).items as Record<string, unknown>[];
    assert.ok(eventItems.some((e) => e.eventType === 'ec2.async_job.created'));

    const crossTenant = await httpJson(
      baseUrl,
      'GET',
      `/api/v1/analysis/jobs/${jobId}`,
      adminB,
    );
    assert.equal(crossTenant.status, 404);
  });

  it('producer service does not depend on STS client', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'services/ec2-async-job-producer-service.ts'),
      'utf8',
    );
    assert.doesNotMatch(source, /@aws-sdk\/client-sts/);
    assert.doesNotMatch(source, /StsClient/);
    assert.doesNotMatch(source, /StsCredentialProvider/);
  });
});
