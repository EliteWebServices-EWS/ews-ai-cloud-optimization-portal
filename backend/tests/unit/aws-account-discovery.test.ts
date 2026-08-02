import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAwsAccountDiscovery } from '../../execution/adapters/sts/aws-account-discovery';
import type { AwsAccountDiscoveryApiClients } from '../../execution/adapters/sts/permission-validator';
import { SISUM_ROLES } from '../../auth';
import { StsCredentialProvider, type StsCredentialProviderDeps } from '../../execution/adapters/sts/sts-credential-provider';
import { assertNoCredentialMaterial } from '../../services/aws-account-discovery-support';

function discoveryClients(
  overrides: Partial<AwsAccountDiscoveryApiClients> = {},
): AwsAccountDiscoveryApiClients {
  return {
    getCallerIdentity: async () => ({
      accountId: '111122223333',
      principalArn: 'arn:aws:sts::111122223333:assumed-role/SisumRole/session',
    }),
    listAccountAliases: async () => ['prod-account'],
    describeEnabledRegions: async () => ['us-east-1', 'us-west-2'],
    describeOrganizationId: async () => 'o-abc123',
    ...overrides,
  };
}

function fakeStsProvider(): StsCredentialProvider {
  return new StsCredentialProvider({
    stsClient: {
      send: async () => ({
        Credentials: {
          AccessKeyId: 'ASIAFAKE',
          SecretAccessKey: 'fake-secret',
          SessionToken: 'fake-session-token',
          Expiration: new Date(Date.now() + 3600_000),
        },
        AssumedRoleUser: { AssumedRoleId: 'AROAFAKE:session' },
      }),
    } as unknown as StsCredentialProviderDeps['stsClient'],
    maxAttempts: 1,
  });
}

function stsContext() {
  return {
    actorId: 'user-1',
    actor: {
      userId: 'user-1',
      email: 'user@example.com',
      authenticated: true,
      roles: [SISUM_ROLES.ADMIN],
    },
    requestId: 'req-1',
    correlationId: 'corr-1',
  };
}

describe('runAwsAccountDiscovery', () => {
  it('discovers caller identity and enabled regions', async () => {
    const result = await runAwsAccountDiscovery({
      registeredAccountId: '111122223333',
      region: 'us-east-1',
      roleConfig: {
        tenantId: 'tenant-a',
        roleArn: 'arn:aws:iam::111122223333:role/SisumRole',
        externalId: 'external-id',
      },
      credentialProvider: fakeStsProvider(),
      stsContext: stsContext(),
      now: () => new Date('2026-08-02T12:00:00.000Z'),
      discoveryClients: discoveryClients(),
    });

    assert.equal(result.accountId, '111122223333');
    assert.match(result.principalArn, /^arn:aws:sts::/);
    assert.equal(result.accountAlias, 'prod-account');
    assert.equal(result.organizationId, 'o-abc123');
    assert.deepEqual(result.enabledRegions, ['us-east-1', 'us-west-2']);
    assert.equal(result.discoveredAt, '2026-08-02T12:00:00.000Z');
  });

  it('records optional alias AccessDenied as a warning', async () => {
    const denied = new Error('denied');
    denied.name = 'AccessDenied';

    const result = await runAwsAccountDiscovery({
      registeredAccountId: '111122223333',
      region: 'us-east-1',
      roleConfig: {
        tenantId: 'tenant-a',
        roleArn: 'arn:aws:iam::111122223333:role/SisumRole',
        externalId: 'external-id',
      },
      credentialProvider: fakeStsProvider(),
      stsContext: stsContext(),
      discoveryClients: discoveryClients({
        listAccountAliases: async () => {
          throw denied;
        },
      }),
    });

    assert.ok(
      result.warnings.some((warning) => warning.code === 'ACCOUNT_ALIAS_UNAVAILABLE'),
    );
  });

  it('never exposes credential material in discovery output', async () => {
    const result = await runAwsAccountDiscovery({
      registeredAccountId: '111122223333',
      region: 'us-east-1',
      roleConfig: {
        tenantId: 'tenant-a',
        roleArn: 'arn:aws:iam::111122223333:role/SisumRole',
        externalId: 'external-id',
      },
      credentialProvider: fakeStsProvider(),
      stsContext: stsContext(),
      discoveryClients: discoveryClients(),
    });

    assert.doesNotThrow(() => assertNoCredentialMaterial(result));
    assert.doesNotThrow(() =>
      assertNoCredentialMaterial(JSON.stringify(result)),
    );
  });

  it('does not mark leastPrivilegeAssurance as VERIFIED', async () => {
    const result = await runAwsAccountDiscovery({
      registeredAccountId: '111122223333',
      region: 'us-east-1',
      roleConfig: {
        tenantId: 'tenant-a',
        roleArn: 'arn:aws:iam::111122223333:role/SisumRole',
        externalId: 'external-id',
      },
      credentialProvider: fakeStsProvider(),
      stsContext: stsContext(),
      discoveryClients: discoveryClients(),
    });

    assert.notEqual(result.permissionSummary.leastPrivilegeAssurance, 'VERIFIED');
  });
});
