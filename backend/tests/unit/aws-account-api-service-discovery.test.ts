import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SISUM_ROLES } from '../../auth';
import { RepositoryConflictError } from '../../database';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import {
  AwsAccountApiService,
  type AwsAccountDiscoveryRunner,
} from '../../services/aws-account-api-service';
import {
  AwsAccountIdentityMismatchError,
  assertNoCredentialMaterial,
} from '../../services/aws-account-discovery-support';
import { StsCredentialProvider } from '../../execution/adapters/sts';

const actor = {
  userId: 'user-1',
  email: 'user@example.com',
  authenticated: true,
  roles: [SISUM_ROLES.ADMIN],
};

function discoveryRunner(
  overrides: Partial<Awaited<ReturnType<AwsAccountDiscoveryRunner>>> = {},
): AwsAccountDiscoveryRunner {
  return async () => ({
    accountId: '111122223333',
    principalArn: 'arn:aws:sts::111122223333:assumed-role/R/session',
    enabledRegions: ['us-east-1'],
    discoveredAt: '2026-08-02T12:00:00.000Z',
    permissionSummary: {
      requiredReadCapabilities: [],
      optionalDiscoveryCapabilities: [],
      leastPrivilegeAssurance: 'NOT_VERIFIED',
      leastPrivilegeReason: 'read probes only',
      executionReadReport: { allGranted: true, results: [] },
    },
    warnings: [],
    ...overrides,
  });
}

describe('AwsAccountApiService.discover', () => {
  it('persists sanitized discovery metadata with optimistic locking', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/R',
      externalId: 'external-id',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: { note: 'legacy' },
    });

    const service = new AwsAccountApiService(
      repository,
      new StsCredentialProvider({ maxAttempts: 1 }),
      {
        async check() {
          return { allGranted: true, results: [] };
        },
      },
      discoveryRunner(),
    );

    const result = await service.discover('tenant-a', created.accountId, {
      actor,
      requestId: 'req-1',
      correlationId: 'corr-1',
    });

    assert.equal(result.account.version, 2);
    const discovery = result.account.metadata.discovery as Record<string, unknown>;
    assert.equal(discovery.accountId, '111122223333');
    assert.equal(result.account.metadata.note, 'legacy');
    assert.doesNotThrow(() => assertNoCredentialMaterial(result.discovery));
  });

  it('fails closed on account ID mismatch without changing status to VERIFIED', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/R',
      externalId: 'external-id',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: {},
    });

    const service = new AwsAccountApiService(
      repository,
      new StsCredentialProvider({ maxAttempts: 1 }),
      {
        async check() {
          return { allGranted: true, results: [] };
        },
      },
      discoveryRunner({ accountId: '999999999999' }),
    );

    await assert.rejects(
      () =>
        service.discover('tenant-a', created.accountId, {
          actor,
          requestId: 'req-1',
          correlationId: 'corr-1',
        }),
      AwsAccountIdentityMismatchError,
    );

    const unchanged = await repository.getById('tenant-a', created.accountId);
    assert.equal(unchanged?.status, 'PENDING');
    assert.equal(unchanged?.metadata.discovery, undefined);
  });

  it('surfaces optimistic-lock conflicts from persistence', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/R',
      externalId: 'external-id',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: {},
    });

    const baseRunner = discoveryRunner();
    const slowRunner: AwsAccountDiscoveryRunner = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return baseRunner(input);
    };

    const service = new AwsAccountApiService(
      repository,
      new StsCredentialProvider({ maxAttempts: 1 }),
      {
        async check() {
          return { allGranted: true, results: [] };
        },
      },
      slowRunner,
    );

    const inFlight = service.discover('tenant-a', created.accountId, {
      actor,
      requestId: 'req-1',
      correlationId: 'corr-1',
    });

    await repository.update(
      'tenant-a',
      created.accountId,
      { metadata: { touched: true } },
      { expectedVersion: 1 },
    );

    await assert.rejects(inFlight, RepositoryConflictError);
  });
});
