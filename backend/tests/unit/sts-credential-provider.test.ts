import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuditEvent } from '../../audit';
import { AUDIT_EVENTS } from '../../audit';
import { StsCredentialProvider } from '../../execution/adapters/sts/sts-credential-provider';
import { StsProviderError, validateRoleConfig } from '../../execution/adapters/sts/sts-types';
import type {
  AwsAccountRoleConfig,
  StsAssumeRoleContext,
} from '../../execution/adapters/sts/sts-types';

const ACTOR = {
  authenticated: true,
  userId: 'system',
  email: null,
  roles: [] as import('../../auth').SisumRole[],
};

function context(overrides: Partial<StsAssumeRoleContext> = {}): StsAssumeRoleContext {
  return {
    actorId: 'system',
    actor: ACTOR,
    requestId: 'req-1',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function config(overrides: Partial<AwsAccountRoleConfig> = {}): AwsAccountRoleConfig {
  return {
    tenantId: 'tenant-a',
    roleArn: 'arn:aws:iam::111122223333:role/SisumReadOnlyRole',
    externalId: 'ext-secret-a',
    ...overrides,
  };
}

interface FakeStsResponse {
  Credentials?: {
    AccessKeyId: string;
    SecretAccessKey: string;
    SessionToken: string;
    Expiration: Date;
  };
  AssumedRoleUser?: { AssumedRoleId: string };
}

function buildFakeStsClient(
  behavior: (attempt: number) => FakeStsResponse | Error | Promise<never>,
) {
  let attempt = 0;
  const calls: unknown[] = [];

  const client = {
    send: async (command: unknown) => {
      attempt += 1;
      calls.push(command);
      const outcome = behavior(attempt);
      if (outcome instanceof Error) {
        throw outcome;
      }
      if (outcome instanceof Promise) {
        return outcome;
      }
      return outcome;
    },
  };

  return { client, calls, attemptCount: () => attempt };
}

function successResponse(expiresInMs = 3600_000): FakeStsResponse {
  return {
    Credentials: {
      AccessKeyId: 'AKIA-fake',
      SecretAccessKey: 'secret-fake',
      SessionToken: 'token-fake',
      Expiration: new Date(Date.now() + expiresInMs),
    },
    AssumedRoleUser: { AssumedRoleId: 'AROAFAKE:sisum-session' },
  };
}

function noDelay(ms: number): Promise<void> {
  void ms;
  return Promise.resolve();
}

describe('validateRoleConfig', () => {
  it('accepts a well-formed config', () => {
    assert.doesNotThrow(() => validateRoleConfig(config()));
  });

  it('rejects a malformed role ARN', () => {
    assert.throws(
      () => validateRoleConfig(config({ roleArn: 'not-an-arn' })),
      (error: unknown) =>
        error instanceof StsProviderError && error.code === 'INVALID_ROLE_ARN',
    );
  });

  it('rejects a missing external ID (confused-deputy protection)', () => {
    assert.throws(
      () => validateRoleConfig(config({ externalId: '' })),
      (error: unknown) =>
        error instanceof StsProviderError && error.code === 'EXTERNAL_ID_REQUIRED',
    );
  });

  it('rejects an out-of-range session duration', () => {
    assert.throws(
      () => validateRoleConfig(config({ durationSeconds: 100 })),
      (error: unknown) =>
        error instanceof StsProviderError && error.code === 'INVALID_DURATION',
    );
  });
});

describe('StsCredentialProvider', () => {
  it('assumes a role and returns temporary credentials', async () => {
    const { client } = buildFakeStsClient(() => successResponse());
    const events: AuditEvent[] = [];

    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
      emitAudit: (event) => {
        events.push(event);
      },
    });

    const credentials = await provider.getCredentials(config(), context());

    assert.equal(credentials.accessKeyId, 'AKIA-fake');
    assert.equal(credentials.sessionToken, 'token-fake');
    assert.equal(
      events.map((e) => e.eventName).join(','),
      `${AUDIT_EVENTS.ASSUME_ROLE_STARTED},${AUDIT_EVENTS.ASSUME_ROLE_SUCCEEDED}`,
    );
  });

  it('never includes secret credential material in audit events', async () => {
    const { client } = buildFakeStsClient(() => successResponse());
    const events: AuditEvent[] = [];

    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
      emitAudit: (event) => {
        events.push(event);
      },
    });

    await provider.getCredentials(config(), context());

    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes('secret-fake'), false);
    assert.equal(serialized.includes('token-fake'), false);
    assert.equal(serialized.includes('AKIA-fake'), false);
  });

  it('reuses cached credentials while they remain fresh', async () => {
    const { client, attemptCount } = buildFakeStsClient(() => successResponse());
    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
    });

    const first = await provider.getCredentials(config(), context());
    const second = await provider.getCredentials(config(), context());

    assert.equal(attemptCount(), 1);
    assert.equal(first.sessionToken, second.sessionToken);
  });

  it('proactively refreshes credentials once inside the refresh margin', async () => {
    let now = Date.now();
    const { client, attemptCount } = buildFakeStsClient(() => successResponse(6 * 60_000));
    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
      now: () => new Date(now),
      refreshMarginMs: 5 * 60_000,
    });

    await provider.getCredentials(config(), context());
    assert.equal(attemptCount(), 1);

    // Advance past the point where < 5 minutes remain on a 6-minute credential.
    now += 90_000;
    await provider.getCredentials(config(), context());
    assert.equal(attemptCount(), 2);
  });

  it('isolates cached credentials per tenant even with identical session prefixes', async () => {
    const { client } = buildFakeStsClient(() => successResponse());
    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
    });

    const tenantA = await provider.getCredentials(
      config({ tenantId: 'tenant-a', roleArn: 'arn:aws:iam::111122223333:role/Shared' }),
      context(),
    );
    const tenantB = await provider.getCredentials(
      config({ tenantId: 'tenant-b', roleArn: 'arn:aws:iam::111122223333:role/Shared' }),
      context(),
    );

    // Different in-memory objects even though the fake STS backend returns
    // structurally similar payloads — proves no cache-key collision.
    assert.notEqual(tenantA, tenantB);
  });

  it('coalesces concurrent requests for the same tenant/role into one AssumeRole call', async () => {
    const { client, attemptCount } = buildFakeStsClient(() => successResponse());
    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
    });

    const [a, b, c] = await Promise.all([
      provider.getCredentials(config(), context()),
      provider.getCredentials(config(), context()),
      provider.getCredentials(config(), context()),
    ]);

    assert.equal(attemptCount(), 1);
    assert.equal(a.sessionToken, b.sessionToken);
    assert.equal(b.sessionToken, c.sessionToken);
  });

  it('retries on throttling and eventually succeeds', async () => {
    const { client, attemptCount } = buildFakeStsClient((attempt) => {
      if (attempt < 3) {
        const error = new Error('Rate exceeded');
        error.name = 'ThrottlingException';
        return error;
      }
      return successResponse();
    });

    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
      maxAttempts: 5,
    });

    const credentials = await provider.getCredentials(config(), context());
    assert.equal(attemptCount(), 3);
    assert.equal(credentials.accessKeyId, 'AKIA-fake');
  });

  it('does not retry AccessDenied and fails fast with a clear reason', async () => {
    const { client, attemptCount } = buildFakeStsClient(() => {
      const error = new Error('User is not authorized to assume role');
      error.name = 'AccessDenied';
      return error;
    });

    const events: AuditEvent[] = [];
    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
      maxAttempts: 5,
      emitAudit: (event) => {
        events.push(event);
      },
    });

    await assert.rejects(
      () => provider.getCredentials(config(), context()),
      (error: unknown) =>
        error instanceof StsProviderError && error.code === 'ASSUME_ROLE_ACCESS_DENIED',
    );

    assert.equal(attemptCount(), 1);
    assert.equal(
      events.map((e) => e.eventName).join(','),
      `${AUDIT_EVENTS.ASSUME_ROLE_STARTED},${AUDIT_EVENTS.ASSUME_ROLE_FAILED}`,
    );
    assert.equal(events.at(-1)?.errorCode, 'ASSUME_ROLE_ACCESS_DENIED');
  });

  it('times out a hanging AssumeRole call instead of blocking indefinitely', async () => {
    const client = {
      send: () => new Promise(() => {}), // never resolves
    };

    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
      timeoutMs: 20,
      maxAttempts: 1,
    });

    await assert.rejects(
      () => provider.getCredentials(config(), context()),
      (error: unknown) =>
        error instanceof StsProviderError && error.code === 'ASSUME_ROLE_TIMEOUT',
    );
  });

  it('invalidate() forces the next call to re-assume the role', async () => {
    const { client, attemptCount } = buildFakeStsClient(() => successResponse());
    const provider = new StsCredentialProvider({
      stsClient: client as never,
      delay: noDelay,
    });

    const cfg = config();
    await provider.getCredentials(cfg, context());
    provider.invalidate(cfg);
    await provider.getCredentials(cfg, context());

    assert.equal(attemptCount(), 2);
  });
});
