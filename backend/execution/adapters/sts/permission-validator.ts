import { DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';
import { ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ListBucketsCommand } from '@aws-sdk/client-s3';

import type { AwsExecutionClients } from '../aws-clients';
import { mapAwsError } from '../aws-error-mapper';

import type {
  AwsAccountCapabilityCheck,
  AwsAccountPermissionSummary,
  PermissionCheckResult,
  PermissionValidationReport,
} from './sts-types';

export interface AwsAccountDiscoveryApiClients {
  getCallerIdentity: () => Promise<{ accountId: string; principalArn: string }>;
  listAccountAliases: () => Promise<string[]>;
  describeEnabledRegions: () => Promise<string[]>;
  describeOrganizationId: () => Promise<string | undefined>;
}

interface RequiredPermissionCheck {
  service: string;
  action: string;
  run: (clients: AwsExecutionClients) => Promise<unknown>;
}

/**
 * One lightweight, read-only call per AWS service — the minimum permission
 * a customer's cross-account role must grant for SISU'M to operate against
 * that service at all. Used at account-connection time to give operators a
 * clear per-service pass/fail report instead of a single opaque failure
 * during the first real execution.
 */
const REQUIRED_PERMISSION_CHECKS: RequiredPermissionCheck[] = [
  {
    service: 'ec2',
    action: 'ec2:DescribeInstances',
    run: (clients) => {
      if (!clients.ec2) throw new Error('EC2 client not configured');
      return clients.ec2.send(new DescribeInstancesCommand({}));
    },
  },
  {
    service: 'autoscaling',
    action: 'autoscaling:DescribeAutoScalingGroups',
    run: (clients) => {
      if (!clients.autoScaling) throw new Error('AutoScaling client not configured');
      return clients.autoScaling.send(new DescribeAutoScalingGroupsCommand({}));
    },
  },
  {
    service: 'rds',
    action: 'rds:DescribeDBInstances',
    run: (clients) => {
      if (!clients.rds) throw new Error('RDS client not configured');
      return clients.rds.send(new DescribeDBInstancesCommand({}));
    },
  },
  {
    service: 's3',
    action: 's3:ListAllMyBuckets',
    run: (clients) => {
      if (!clients.s3) throw new Error('S3 client not configured');
      return clients.s3.send(new ListBucketsCommand({}));
    },
  },
  {
    service: 'cloudfront',
    action: 'cloudfront:ListDistributions',
    run: (clients) => {
      if (!clients.cloudFront) throw new Error('CloudFront client not configured');
      return clients.cloudFront.send(new ListDistributionsCommand({}));
    },
  },
  {
    service: 'lambda',
    action: 'lambda:ListFunctions',
    run: (clients) => {
      if (!clients.lambda) throw new Error('Lambda client not configured');
      return clients.lambda.send(new ListFunctionsCommand({}));
    },
  },
];

function isAccessDenied(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'AccessDenied' || name === 'AccessDeniedException';
}

/**
 * Runs the required read-only permission checks against an already-assumed
 * set of AWS service clients and reports which are granted.
 *
 * A check that fails for a reason other than AccessDenied (e.g. throttling,
 * timeout) is reported as ungranted with the underlying error surfaced, but
 * is distinguishable via the error code so operators can tell "not
 * permitted" apart from "AWS was unreachable".
 */
export async function validateRequiredPermissions(
  clients: AwsExecutionClients,
): Promise<PermissionValidationReport> {
  const results: PermissionCheckResult[] = await Promise.all(
    REQUIRED_PERMISSION_CHECKS.map(async (check) => {
      try {
        await check.run(clients);
        return {
          service: check.service,
          action: check.action,
          granted: true,
        };
      } catch (error) {
        return {
          service: check.service,
          action: check.action,
          granted: false,
          error: {
            ...mapAwsError(error, 'permission-validation'),
            code: isAccessDenied(error)
              ? 'PERMISSION_DENIED'
              : mapAwsError(error, 'permission-validation').code,
          },
        };
      }
    }),
  );

  return {
    allGranted: results.every((result) => result.granted),
    results,
  };
}

const LEAST_PRIVILEGE_DEFAULT_REASON =
  'Successful read-only probes do not prove the role lacks write permissions. ' +
  'Review the customer IAM policy for least privilege.';

const DISCOVERY_REQUIRED_CHECKS: Array<{
  capability: string;
  action: string;
  run: (clients: AwsAccountDiscoveryApiClients) => Promise<unknown>;
}> = [
  {
    capability: 'caller-identity',
    action: 'sts:GetCallerIdentity',
    run: (clients) => clients.getCallerIdentity(),
  },
  {
    capability: 'enabled-regions',
    action: 'ec2:DescribeRegions',
    run: (clients) => clients.describeEnabledRegions(),
  },
];

const DISCOVERY_OPTIONAL_CHECKS: Array<{
  capability: string;
  action: string;
  run: (clients: AwsAccountDiscoveryApiClients) => Promise<unknown>;
}> = [
  {
    capability: 'account-alias',
    action: 'iam:ListAccountAliases',
    run: (clients) => clients.listAccountAliases(),
  },
  {
    capability: 'organization',
    action: 'organizations:DescribeOrganization',
    run: (clients) => clients.describeOrganizationId(),
  },
];

async function runCapabilityCheck(
  capability: string,
  action: string,
  run: () => Promise<unknown>,
  optional: boolean,
): Promise<AwsAccountCapabilityCheck> {
  try {
    await run();
    return { capability, action, status: 'VERIFIED' };
  } catch (error) {
    if (optional && isAccessDenied(error)) {
      return {
        capability,
        action,
        status: 'UNAVAILABLE',
        errorCode: 'PERMISSION_DENIED',
      };
    }

    if (isAccessDenied(error)) {
      return {
        capability,
        action,
        status: 'FAILED',
        errorCode: 'PERMISSION_DENIED',
      };
    }

    return {
      capability,
      action,
      status: optional ? 'UNAVAILABLE' : 'FAILED',
      errorCode: mapAwsError(error, 'permission-validation').code,
    };
  }
}

function executionChecksToCapabilities(
  report: PermissionValidationReport,
): AwsAccountCapabilityCheck[] {
  return report.results.map((result) => ({
    capability: result.service,
    action: result.action,
    status: result.granted ? 'VERIFIED' : 'FAILED',
    errorCode: result.error?.code,
  }));
}

/**
 * Builds a structured permission summary for discovery and onboarding.
 * Does not perform write/delete/stop probes and does not claim least
 * privilege is proven without IAM policy evidence.
 */
export async function buildAwsAccountPermissionSummary(
  executionClients: AwsExecutionClients,
  discoveryClients: AwsAccountDiscoveryApiClients,
): Promise<AwsAccountPermissionSummary> {
  const executionReadReport = await validateRequiredPermissions(executionClients);

  const requiredDiscovery = await Promise.all(
    DISCOVERY_REQUIRED_CHECKS.map((check) =>
      runCapabilityCheck(
        check.capability,
        check.action,
        () => check.run(discoveryClients),
        false,
      ),
    ),
  );

  const optionalDiscovery = await Promise.all(
    DISCOVERY_OPTIONAL_CHECKS.map((check) =>
      runCapabilityCheck(
        check.capability,
        check.action,
        () => check.run(discoveryClients),
        true,
      ),
    ),
  );

  const requiredReadCapabilities = [
    ...executionChecksToCapabilities(executionReadReport),
    ...requiredDiscovery,
  ];

  return {
    requiredReadCapabilities,
    optionalDiscoveryCapabilities: optionalDiscovery,
    leastPrivilegeAssurance: 'NOT_VERIFIED',
    leastPrivilegeReason: LEAST_PRIVILEGE_DEFAULT_REASON,
    executionReadReport,
  };
}

export function assertSessionNotExpired(
  expiration: Date,
  now: Date = new Date(),
): void {
  if (expiration.getTime() <= now.getTime()) {
    throw new Error(
      `AWS session expired at ${expiration.toISOString()} (checked at ${now.toISOString()}).`,
    );
  }
}
