import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InvalidPaginationTokenError,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';

import type { CreateAwsAccountInput } from '../../repositories/contracts';

import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';

function createInput(
  overrides: Partial<CreateAwsAccountInput> = {},
): CreateAwsAccountInput {
  return {
    accountId: '123456789012',
    tenantId: 'tenant-a',
    roleArn: 'arn:aws:iam::123456789012:role/SisumOnboardingRole',
    externalId: 'external-id-a',
    region: 'us-east-2',
    status: 'PENDING',
    verificationStatus: 'NOT_STARTED',
    metadata: {},
    ...overrides,
  };
}

describe('MockAwsAccountRepository', () => {
  it('creates and gets by tenant scope', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create(createInput());

    const loaded = await repository.getById('tenant-a', '123456789012');
    assert.deepEqual(loaded, created);
    assert.notEqual(loaded, created);
  });

  it('rejects duplicate create for same tenant', async () => {
    const repository = new MockAwsAccountRepository();
    await repository.create(createInput());

    await assert.rejects(
      () => repository.create(createInput()),
      RepositoryAlreadyExistsError,
    );
  });

  it('enforces tenant isolation on get', async () => {
    const repository = new MockAwsAccountRepository();
    await repository.create(createInput());

    assert.equal(
      await repository.getById('tenant-b', '123456789012'),
      undefined,
    );
  });

  it('lists by tenant with pagination and rejects wrong token scope', async () => {
    const repository = new MockAwsAccountRepository();
    await repository.create(
      createInput({
        accountId: '111111111111',
        roleArn: 'arn:aws:iam::111111111111:role/SisumOnboardingRole',
      }),
    );
    await repository.create(
      createInput({
        accountId: '222222222222',
        roleArn: 'arn:aws:iam::222222222222:role/SisumOnboardingRole',
      }),
    );

    const page = await repository.listByTenant('tenant-a', { limit: 1 });
    assert.equal(page.items.length, 1);
    assert.ok(page.nextToken);

    const page2 = await repository.listByTenant('tenant-a', {
      limit: 1,
      nextToken: page.nextToken,
    });
    assert.equal(page2.items.length, 1);

    await assert.rejects(
      () =>
        repository.listByTenant('tenant-b', {
          nextToken: page.nextToken,
        }),
      InvalidPaginationTokenError,
    );
  });

  it('lists by status', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create(createInput());
    await repository.transitionStatus(
      'tenant-a',
      created.accountId,
      'VALIDATING',
      { expectedVersion: 1 },
    );

    const pending = await repository.listByStatus('tenant-a', 'PENDING');
    assert.equal(pending.items.length, 0);

    const validating = await repository.listByStatus(
      'tenant-a',
      'VALIDATING',
    );
    assert.equal(validating.items.length, 1);
  });

  it('sets lastValidated when validation fails (VALIDATING to PENDING)', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create(createInput());

    await repository.transitionStatus(
      'tenant-a',
      created.accountId,
      'VALIDATING',
      { expectedVersion: 1 },
    );

    const failed = await repository.transitionStatus(
      'tenant-a',
      created.accountId,
      'PENDING',
      { expectedVersion: 2 },
    );

    assert.equal(failed.verificationStatus, 'FAILED');
    assert.ok(failed.lastValidated);
    assert.equal(Number.isNaN(Date.parse(failed.lastValidated!)), false);
  });

  it('preserves lastValidated while re-entering VALIDATING', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create(createInput());

    await repository.transitionStatus(
      'tenant-a',
      created.accountId,
      'VALIDATING',
      { expectedVersion: 1 },
    );

    const failed = await repository.transitionStatus(
      'tenant-a',
      created.accountId,
      'PENDING',
      { expectedVersion: 2 },
    );

    const previousLastValidated = failed.lastValidated;
    assert.ok(previousLastValidated);

    const validatingAgain = await repository.transitionStatus(
      'tenant-a',
      created.accountId,
      'VALIDATING',
      { expectedVersion: 3 },
    );

    assert.equal(validatingAgain.verificationStatus, 'IN_PROGRESS');
    assert.equal(validatingAgain.lastValidated, previousLastValidated);
  });

  it('looks up by AWS account ID globally', async () => {
    const repository = new MockAwsAccountRepository();
    await repository.create(createInput());

    const found = await repository.getByAccountId('123456789012');
    assert.equal(found?.tenantId, 'tenant-a');
  });

  it('rejects global duplicate registration across tenants', async () => {
    const repository = new MockAwsAccountRepository();
    await repository.create(createInput({ tenantId: 'tenant-a' }));

    await assert.rejects(
      () =>
        repository.create(
          createInput({
            tenantId: 'tenant-b',
            externalId: 'other-external',
          }),
        ),
      RepositoryAlreadyExistsError,
    );
  });

  it('increments version exactly once on update conflict path', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create(createInput());

    const updated = await repository.update(
      'tenant-a',
      created.accountId,
      { metadata: { note: 'updated' } },
      { expectedVersion: 1 },
    );
    assert.equal(updated.version, 2);

    await assert.rejects(
      () =>
        repository.update(
          'tenant-a',
          created.accountId,
          { metadata: { note: 'stale' } },
          { expectedVersion: 1 },
        ),
      RepositoryConflictError,
    );
  });

  it('concurrent updates: one success and one conflict', async () => {
    const repository = new MockAwsAccountRepository();
    const created = await repository.create(createInput());

    const first = repository.update(
      'tenant-a',
      created.accountId,
      { metadata: { winner: 'first' } },
      { expectedVersion: 1 },
    );

    const second = repository.update(
      'tenant-a',
      created.accountId,
      { metadata: { winner: 'second' } },
      { expectedVersion: 1 },
    );

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]?.reason instanceof RepositoryConflictError,
    );
  });

  it('throws not found for missing records', async () => {
    const repository = new MockAwsAccountRepository();

    await assert.rejects(
      () =>
        repository.update(
          'tenant-a',
          '123456789012',
          { metadata: {} },
          { expectedVersion: 1 },
        ),
      RepositoryNotFoundError,
    );
  });
});
