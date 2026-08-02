import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertSessionNotExpired,
  buildAwsAccountPermissionSummary,
  validateRequiredPermissions,
} from '../../execution/adapters/sts/permission-validator';
import type { AwsExecutionClients } from '../../execution/adapters/aws-clients';

function accessDenied(): Error {
  const error = new Error('not authorized');
  error.name = 'AccessDenied';
  return error;
}

function allGrantedClients(): AwsExecutionClients {
  const ok = { send: async () => ({}) };
  return {
    ec2: ok as never,
    autoScaling: ok as never,
    rds: ok as never,
    s3: ok as never,
    cloudFront: ok as never,
    lambda: ok as never,
  };
}

describe('validateRequiredPermissions', () => {
  it('reports all services granted when every read call succeeds', async () => {
    const report = await validateRequiredPermissions(allGrantedClients());

    assert.equal(report.allGranted, true);
    assert.equal(report.results.length, 6);
    assert.ok(report.results.every((r) => r.granted));
  });

  it('reports a single denied service without failing the others', async () => {
    const clients = allGrantedClients();
    clients.rds = { send: async () => { throw accessDenied(); } } as never;

    const report = await validateRequiredPermissions(clients);

    assert.equal(report.allGranted, false);
    const rdsResult = report.results.find((r) => r.service === 'rds');
    assert.equal(rdsResult?.granted, false);
    assert.equal(rdsResult?.error?.code, 'PERMISSION_DENIED');

    const others = report.results.filter((r) => r.service !== 'rds');
    assert.ok(others.every((r) => r.granted));
  });

  it('distinguishes throttling/network failures from permission denials', async () => {
    const clients = allGrantedClients();
    const throttled = new Error('Rate exceeded');
    throttled.name = 'ThrottlingException';
    clients.s3 = { send: async () => { throw throttled; } } as never;

    const report = await validateRequiredPermissions(clients);
    const s3Result = report.results.find((r) => r.service === 's3');

    assert.equal(s3Result?.granted, false);
    assert.notEqual(s3Result?.error?.code, 'PERMISSION_DENIED');
  });

  it('reports every configured service as its own check', async () => {
    const report = await validateRequiredPermissions(allGrantedClients());
    assert.deepEqual(
      report.results.map((r) => r.service).sort(),
      ['autoscaling', 'cloudfront', 'ec2', 'lambda', 'rds', 's3'],
    );
  });
});

describe('buildAwsAccountPermissionSummary', () => {
  it('marks optional discovery capabilities unavailable on AccessDenied', async () => {
    const denied = new Error('denied');
    denied.name = 'AccessDenied';

    const summary = await buildAwsAccountPermissionSummary(allGrantedClients(), {
      getCallerIdentity: async () => ({
        accountId: '111122223333',
        principalArn: 'arn:aws:sts::111122223333:assumed-role/R/session',
      }),
      describeEnabledRegions: async () => ['us-east-1'],
      listAccountAliases: async () => {
        throw denied;
      },
      describeOrganizationId: async () => {
        throw denied;
      },
    });

    const alias = summary.optionalDiscoveryCapabilities.find(
      (entry) => entry.capability === 'account-alias',
    );
    assert.equal(alias?.status, 'UNAVAILABLE');
    assert.equal(summary.leastPrivilegeAssurance, 'NOT_VERIFIED');
  });
});

describe('assertSessionNotExpired', () => {
  it('does not throw for a future expiration', () => {
    const future = new Date(Date.now() + 60_000);
    assert.doesNotThrow(() => assertSessionNotExpired(future, new Date()));
  });

  it('throws for a past expiration', () => {
    const past = new Date(Date.now() - 1000);
    assert.throws(() => assertSessionNotExpired(past, new Date()), /expired/);
  });
});
