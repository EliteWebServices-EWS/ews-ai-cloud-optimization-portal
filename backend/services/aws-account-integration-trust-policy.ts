/**
 * Canonical customer integration role trust policy for SISU'M cross-account access.
 * Customer roles (e.g. SisumReadOnlyIntegrationRole) are created in the tenant AWS account;
 * this document is documentation + registration guidance, not platform CloudFormation.
 */

export const SISUM_PLATFORM_TRUSTED_ROLE_NAMES = [
  'SisumLambdaExecutionRole',
  'SisumEc2AnalysisConsumerExecutionRole',
] as const;

export type SisumPlatformTrustedRoleName = (typeof SISUM_PLATFORM_TRUSTED_ROLE_NAMES)[number];

export interface BuildSisumCustomerIntegrationRoleTrustPolicyInput {
  /** Platform AWS account ID (12 digits) that hosts SISU'M Lambda roles. */
  platformAccountId: string;
  /** Tenant-specific ExternalId from registration (confused-deputy protection). */
  externalId: string;
  /** IAM partition; defaults to aws. */
  partition?: string;
}

export function buildSisumPlatformTrustedRoleArn(
  platformAccountId: string,
  roleName: SisumPlatformTrustedRoleName,
  partition = 'aws',
): string {
  return `arn:${partition}:iam::${platformAccountId}:role/${roleName}`;
}

export function buildSisumCustomerIntegrationRoleTrustPolicy(
  input: BuildSisumCustomerIntegrationRoleTrustPolicyInput,
): Record<string, unknown> {
  const partition = input.partition ?? 'aws';
  const principals = SISUM_PLATFORM_TRUSTED_ROLE_NAMES.map((roleName) =>
    buildSisumPlatformTrustedRoleArn(input.platformAccountId, roleName, partition),
  );

  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          AWS: principals,
        },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: {
            'sts:ExternalId': input.externalId,
          },
        },
      },
    ],
  };
}
