import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  DescribeAddressesCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeLaunchTemplatesCommand,
  DescribeNetworkInterfacesCommand,
  DescribePlacementGroupsCommand,
  DescribeSecurityGroupsCommand,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';

import {
  assertSessionNotExpired,
  buildAwsAccountPermissionSummary,
  MANDATORY_EC2_DISCOVERY_IAM_ACTIONS,
  REQUIRED_PERMISSION_CHECKS,
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

function ec2ActionsFromChecks(): string[] {
  return REQUIRED_PERMISSION_CHECKS.filter((check) => check.service === 'ec2').map(
    (check) => check.action,
  );
}

function clientsWithEc2CommandDenied(
  DeniedCommand: new (...args: never[]) => unknown,
): AwsExecutionClients {
  const clients = allGrantedClients();
  clients.ec2 = {
    send: async (command: unknown) => {
      if (command instanceof DeniedCommand) {
        throw accessDenied();
      }
      return {};
    },
  } as never;
  return clients;
}

const LEGACY_NON_EC2_ACTIONS = [
  'autoscaling:DescribeAutoScalingGroups',
  'rds:DescribeDBInstances',
  's3:ListAllMyBuckets',
  'cloudfront:ListDistributions',
  'lambda:ListFunctions',
] as const;

describe('REQUIRED_PERMISSION_CHECKS contract', () => {
  it('includes every mandatory EC2 discovery action exactly once', () => {
    const ec2Actions = ec2ActionsFromChecks();
    assert.deepEqual([...ec2Actions].sort(), [...MANDATORY_EC2_DISCOVERY_IAM_ACTIONS].sort());
    for (const action of MANDATORY_EC2_DISCOVERY_IAM_ACTIONS) {
      assert.equal(ec2Actions.filter((entry) => entry === action).length, 1, action);
    }
  });

  it('matches the mandatory discovery adapter action set exactly', () => {
    assert.equal(ec2ActionsFromChecks().length, MANDATORY_EC2_DISCOVERY_IAM_ACTIONS.length);
    assert.deepEqual(new Set(ec2ActionsFromChecks()), new Set(MANDATORY_EC2_DISCOVERY_IAM_ACTIONS));
  });

  it('does not introduce ec2:* or ec2:Describe* wildcards', () => {
    for (const check of REQUIRED_PERMISSION_CHECKS) {
      assert.notEqual(check.action, 'ec2:*');
      assert.notEqual(check.action, 'ec2:Describe*');
      assert.doesNotMatch(check.action, /^ec2:\*$/);
      assert.doesNotMatch(check.action, /^ec2:Describe\*$/);
    }
  });

  it('retains existing non-EC2 required permission actions', () => {
    const actions = new Set(REQUIRED_PERMISSION_CHECKS.map((check) => check.action));
    for (const action of LEGACY_NON_EC2_ACTIONS) {
      assert.ok(actions.has(action), action);
    }
  });
});

describe('validateRequiredPermissions', () => {
  it('reports allGranted true when every probe succeeds', async () => {
    const report = await validateRequiredPermissions(allGrantedClients());

    assert.equal(report.allGranted, true);
    assert.equal(report.results.length, REQUIRED_PERMISSION_CHECKS.length);
    assert.ok(report.results.every((r) => r.granted));
  });

  it('reports all eight EC2 probes granted when EC2 client accepts all commands', async () => {
    const seen = new Set<string>();
    const clients = allGrantedClients();
    clients.ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeInstancesCommand) seen.add('ec2:DescribeInstances');
        if (command instanceof DescribeImagesCommand) seen.add('ec2:DescribeImages');
        if (command instanceof DescribeVolumesCommand) seen.add('ec2:DescribeVolumes');
        if (command instanceof DescribeAddressesCommand) seen.add('ec2:DescribeAddresses');
        if (command instanceof DescribeNetworkInterfacesCommand) {
          seen.add('ec2:DescribeNetworkInterfaces');
        }
        if (command instanceof DescribePlacementGroupsCommand) {
          seen.add('ec2:DescribePlacementGroups');
        }
        if (command instanceof DescribeLaunchTemplatesCommand) {
          seen.add('ec2:DescribeLaunchTemplates');
        }
        if (command instanceof DescribeSecurityGroupsCommand) {
          seen.add('ec2:DescribeSecurityGroups');
        }
        return {};
      },
    } as never;

    const report = await validateRequiredPermissions(clients);
    assert.equal(report.allGranted, true);
    assert.deepEqual([...seen].sort(), [...MANDATORY_EC2_DISCOVERY_IAM_ACTIONS].sort());
    for (const action of MANDATORY_EC2_DISCOVERY_IAM_ACTIONS) {
      assert.equal(report.results.find((r) => r.action === action)?.granted, true, action);
    }
  });

  for (const [label, Command, action] of [
    ['DescribeImages', DescribeImagesCommand, 'ec2:DescribeImages'],
    ['DescribeVolumes', DescribeVolumesCommand, 'ec2:DescribeVolumes'],
    ['DescribeAddresses', DescribeAddressesCommand, 'ec2:DescribeAddresses'],
    ['DescribeNetworkInterfaces', DescribeNetworkInterfacesCommand, 'ec2:DescribeNetworkInterfaces'],
    ['DescribePlacementGroups', DescribePlacementGroupsCommand, 'ec2:DescribePlacementGroups'],
    ['DescribeLaunchTemplates', DescribeLaunchTemplatesCommand, 'ec2:DescribeLaunchTemplates'],
    ['DescribeSecurityGroups', DescribeSecurityGroupsCommand, 'ec2:DescribeSecurityGroups'],
  ] as const) {
    it(`sets allGranted false when ${label} is denied`, async () => {
      const report = await validateRequiredPermissions(clientsWithEc2CommandDenied(Command));
      assert.equal(report.allGranted, false);
      const denied = report.results.find((r) => r.action === action);
      assert.equal(denied?.granted, false);
      assert.equal(denied?.error?.code, 'PERMISSION_DENIED');
      assert.equal(denied?.service, 'ec2');
    });
  }

  it('reports AccessDenied with PERMISSION_DENIED without breaking result shape', async () => {
    const report = await validateRequiredPermissions(
      clientsWithEc2CommandDenied(DescribeVolumesCommand),
    );
    const volumes = report.results.find((r) => r.action === 'ec2:DescribeVolumes');
    assert.equal(volumes?.granted, false);
    assert.equal(volumes?.error?.code, 'PERMISSION_DENIED');
    assert.equal(typeof volumes?.service, 'string');
    assert.equal(typeof volumes?.action, 'string');
  });

  it('reports a single denied non-EC2 service without failing the others', async () => {
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

  it('returns one result per required check', async () => {
    const report = await validateRequiredPermissions(allGrantedClients());
    assert.equal(report.results.length, REQUIRED_PERMISSION_CHECKS.length);
    assert.equal(report.results.length, 8 + LEGACY_NON_EC2_ACTIONS.length);
  });

  it('preserves backward-compatible permission report fields', async () => {
    const report = await validateRequiredPermissions(allGrantedClients());
    assert.equal(typeof report.allGranted, 'boolean');
    for (const result of report.results) {
      assert.equal(typeof result.service, 'string');
      assert.equal(typeof result.action, 'string');
      assert.equal(typeof result.granted, 'boolean');
      if (result.error) {
        assert.equal(typeof result.error.code, 'string');
        assert.doesNotMatch(JSON.stringify(result.error), /secretaccesskey/i);
      }
    }
  });
});

describe('platform Lambda IAM (no direct customer EC2 reads)', () => {
  const template = readFileSync(join(process.cwd(), 'template.yaml'), 'utf8');

  it('does not grant ec2:Describe* on SisumLambdaExecutionRole persistence policies', () => {
    const policySection = template.slice(
      template.indexOf('SisumBusinessPersistencePolicy'),
      template.indexOf('SisumStsAssumeRolePolicy'),
    );
    assert.doesNotMatch(policySection, /ec2:Describe/);
    assert.doesNotMatch(policySection, /ec2:\*/);
  });
});

describe('customer role documentation', () => {
  it('documents dual platform trust principals in integration trust policy doc', () => {
    const doc = readFileSync(
      join(process.cwd(), '../docs/operations/aws-account-integration-trust-policy.md'),
      'utf8',
    );
    assert.match(doc, /SisumLambdaExecutionRole/);
    assert.match(doc, /SisumEc2AnalysisConsumerExecutionRole/);
    assert.match(doc, /sts:ExternalId/);
  });

  it('lists every mandatory EC2 discovery action in EC2 discovery security doc', () => {
    const doc = readFileSync(
      join(process.cwd(), '../docs/security/ec2-discovery-security.md'),
      'utf8',
    );
    for (const action of MANDATORY_EC2_DISCOVERY_IAM_ACTIONS) {
      assert.match(doc, new RegExp(action.replace(':', '\\:')), action);
    }
  });

  it('production validation guide requires reverification after role update', () => {
    const doc = readFileSync(
      join(process.cwd(), '../docs/validation/ec2-security-production-validation.md'),
      'utf8',
    );
    assert.match(doc, /ec2:DescribeSecurityGroups/);
    assert.match(doc, /Reverify|reverify|verification/i);
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

    for (const action of MANDATORY_EC2_DISCOVERY_IAM_ACTIONS) {
      const capability = summary.requiredReadCapabilities.find((entry) => entry.action === action);
      assert.equal(capability?.status, 'VERIFIED', action);
    }
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
