import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatExternalIdPresence,
  getDataEnvelope,
  getDiscoveryData,
  getRegistrationRecord,
  getVerificationData,
  redactSensitive,
  Sprint13EvidenceValidationError,
  validateDiscoveryEvidence,
  validateRegistrationEvidence,
  validateVerificationEvidence,
} from '../../scripts/lib/sprint-13-production-readiness-evidence';

const ACCOUNT = '111122223333';
const TENANT = 'tenant-synthetic-abc';

describe('Sprint 13 production readiness evidence parsing', () => {
  it('parses real registration envelope', () => {
    const payload = {
      success: true,
      data: {
        tenantId: TENANT,
        accountId: ACCOUNT,
        status: 'PENDING',
        verificationStatus: 'NOT_STARTED',
        version: 1,
      },
    };
    const record = getRegistrationRecord(payload);
    assert.equal(record.accountId, ACCOUNT);
    assert.equal(record.tenantId, TENANT);
  });

  it('parses real verification envelope', () => {
    const payload = {
      success: true,
      data: {
        account: {
          tenantId: TENANT,
          accountId: ACCOUNT,
          status: 'VERIFIED',
          verificationStatus: 'SUCCEEDED',
          version: 3,
        },
        succeeded: true,
        permissionReport: {
          allGranted: true,
          results: [{ permission: 'ec2:DescribeInstances', granted: true }],
        },
      },
    };
    const parsed = getVerificationData(payload);
    assert.equal(parsed.account.version, 3);
    assert.equal(parsed.succeeded, true);
    assert.equal(parsed.permissionReport?.allGranted, true);
  });

  it('parses real discovery envelope', () => {
    const payload = {
      success: true,
      data: {
        account: {
          tenantId: TENANT,
          accountId: ACCOUNT,
          status: 'VERIFIED',
          version: 4,
          metadata: { discovery: { accountId: ACCOUNT, region: 'us-east-1' } },
        },
        discovery: {
          accountId: ACCOUNT,
          principalArn: `arn:aws:sts::${ACCOUNT}:assumed-role/SisumReadOnlyIntegrationRole/session`,
          permissionSummary: {
            leastPrivilegeAssurance: 'NOT_VERIFIED',
            requiredReadCapabilities: [{ name: 'sts:GetCallerIdentity', status: 'VERIFIED' }],
            executionReadReport: { allGranted: true },
          },
          warnings: [],
        },
      },
    };
    const parsed = getDiscoveryData(payload);
    assert.equal(parsed.account.version, 4);
    assert.equal(parsed.discovery.accountId, ACCOUNT);
  });

  it('supports direct inner registration record', () => {
    const direct = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      status: 'PENDING',
      version: 1,
    };
    const record = getRegistrationRecord(direct);
    assert.equal(record.accountId, ACCOUNT);
  });

  it('supports direct inner verification account record', () => {
    const direct = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      status: 'VERIFIED',
      verificationStatus: 'SUCCEEDED',
      version: 3,
    };
    const parsed = getVerificationData(direct);
    assert.equal(parsed.account.status, 'VERIFIED');
  });

  it('supports direct discovery object with permissionSummary', () => {
    const direct = {
      accountId: ACCOUNT,
      tenantId: TENANT,
      status: 'VERIFIED',
      version: 4,
      principalArn: `arn:aws:sts::${ACCOUNT}:assumed-role/RoleName/session`,
      permissionSummary: {
        leastPrivilegeAssurance: 'NOT_VERIFIED',
        requiredReadCapabilities: [{ id: 'ec2', status: 'VERIFIED' }],
        executionReadReport: { allGranted: true },
      },
    };
    const parsed = getDiscoveryData(direct);
    assert.equal(parsed.discovery.accountId, ACCOUNT);
  });

  it('fails registration when accountId does not match expected', () => {
    const payload = {
      success: true,
      data: { tenantId: TENANT, accountId: '999999999999', status: 'PENDING', version: 1 },
    };
    assert.throws(
      () =>
        validateRegistrationEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      (error: unknown) =>
        error instanceof Sprint13EvidenceValidationError &&
        /accountId/.test(error.message),
    );
  });

  it('fails when tenantId does not match expected', () => {
    const payload = {
      success: true,
      data: {
        tenantId: 'tenant-other',
        accountId: ACCOUNT,
        status: 'PENDING',
        version: 1,
      },
    };
    assert.throws(
      () =>
        validateRegistrationEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /tenantId/,
    );
  });

  it('fails verification when data.succeeded is false', () => {
    const payload = {
      success: true,
      data: {
        account: {
          tenantId: TENANT,
          accountId: ACCOUNT,
          status: 'VERIFIED',
          verificationStatus: 'SUCCEEDED',
          version: 3,
        },
        succeeded: false,
        permissionReport: { allGranted: true, results: [] },
      },
    };
    assert.throws(
      () =>
        validateVerificationEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /succeeded is false/,
    );
  });

  it('fails verification when permissionReport.allGranted is false', () => {
    const payload = {
      success: true,
      data: {
        account: {
          tenantId: TENANT,
          accountId: ACCOUNT,
          status: 'VERIFIED',
          verificationStatus: 'SUCCEEDED',
          version: 3,
        },
        succeeded: true,
        permissionReport: {
          allGranted: false,
          results: [{ permission: 'ec2:DescribeInstances', granted: true }],
        },
      },
    };
    assert.throws(
      () =>
        validateVerificationEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /allGranted/,
    );
  });

  it('fails verification when any permission result granted is false', () => {
    const payload = {
      success: true,
      data: {
        account: {
          tenantId: TENANT,
          accountId: ACCOUNT,
          status: 'VERIFIED',
          verificationStatus: 'SUCCEEDED',
          version: 3,
        },
        succeeded: true,
        permissionReport: {
          allGranted: true,
          results: [
            { permission: 'ec2:DescribeInstances', granted: true },
            { permission: 's3:ListAllMyBuckets', granted: false },
          ],
        },
      },
    };
    assert.throws(
      () =>
        validateVerificationEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /not granted/,
    );
  });

  it('fails discovery when leastPrivilegeAssurance is VERIFIED', () => {
    const payload = discoveryEnvelope({
      leastPrivilegeAssurance: 'VERIFIED',
    });
    assert.throws(
      () =>
        validateDiscoveryEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /must not be VERIFIED/,
    );
  });

  it('fails discovery when leastPrivilegeAssurance is missing', () => {
    const payload = discoveryEnvelope({ omitLpa: true });
    assert.throws(
      () =>
        validateDiscoveryEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /leastPrivilegeAssurance is missing/,
    );
  });

  it('fails discovery when required capability status is not VERIFIED', () => {
    const payload = discoveryEnvelope({
      capabilities: [{ name: 'ec2:DescribeRegions', status: 'FAILED' }],
    });
    assert.throws(
      () =>
        validateDiscoveryEvidence(payload, {
          expectedAccountId: ACCOUNT,
          expectedTenantId: TENANT,
        }),
      /non-VERIFIED/,
    );
  });

  it('fails when data envelope is missing or malformed', () => {
    assert.throws(
      () => getDataEnvelope({ success: true, data: null }),
      /malformed data envelope/,
    );
    assert.throws(
      () => getDataEnvelope({ success: false, data: { accountId: ACCOUNT } }),
      /success is false/,
    );
  });

  it('never prints externalId unredacted in formatExternalIdPresence', () => {
    const secretExternalId =
      'synthetic-external-id-0123456789abcdef0123456789abcdef0123456789';
    const line = formatExternalIdPresence({ externalId: secretExternalId });
    assert.ok(line.includes('externalId present'));
    assert.ok(!line.includes(secretExternalId));
    assert.equal(redactSensitive(secretExternalId).includes(secretExternalId), false);
  });

  it('validates full registration verification discovery envelopes end-to-end', () => {
    validateRegistrationEvidence(
      {
        success: true,
        data: {
          tenantId: TENANT,
          accountId: ACCOUNT,
          status: 'PENDING',
          verificationStatus: 'NOT_STARTED',
          version: 1,
        },
      },
      { expectedAccountId: ACCOUNT, expectedTenantId: TENANT },
    );

    validateVerificationEvidence(
      {
        success: true,
        data: {
          account: {
            tenantId: TENANT,
            accountId: ACCOUNT,
            status: 'VERIFIED',
            verificationStatus: 'SUCCEEDED',
            version: 3,
          },
          succeeded: true,
          permissionReport: {
            allGranted: true,
            results: [{ permission: 'lambda:ListFunctions', granted: true }],
          },
        },
      },
      { expectedAccountId: ACCOUNT, expectedTenantId: TENANT },
    );

    validateDiscoveryEvidence(discoveryEnvelope(), {
      expectedAccountId: ACCOUNT,
      expectedTenantId: TENANT,
    });
  });
});

function discoveryEnvelope(options?: {
  leastPrivilegeAssurance?: string;
  omitLpa?: boolean;
  capabilities?: Array<{ name: string; status: string }>;
}): Record<string, unknown> {
  const permissionSummary: Record<string, unknown> = {
    requiredReadCapabilities: options?.capabilities ?? [
      { name: 'sts:GetCallerIdentity', status: 'VERIFIED' },
    ],
    executionReadReport: { allGranted: true },
  };
  if (!options?.omitLpa) {
    permissionSummary.leastPrivilegeAssurance =
      options?.leastPrivilegeAssurance ?? 'NOT_VERIFIED';
  }

  return {
    success: true,
    data: {
      account: {
        tenantId: TENANT,
        accountId: ACCOUNT,
        status: 'VERIFIED',
        version: 4,
        metadata: {
          discovery: { accountId: ACCOUNT, capturedAt: '2026-01-01T00:00:00.000Z' },
        },
      },
      discovery: {
        accountId: ACCOUNT,
        principalArn: `arn:aws:sts::${ACCOUNT}:assumed-role/SisumReadOnlyIntegrationRole/synthetic-session`,
        permissionSummary,
        warnings: ['ACCOUNT_ALIAS_UNAVAILABLE'],
      },
    },
  };
}
