import { mapAwsError } from '../aws-error-mapper';

import { createAssumeRoleClientFactory } from './aws-service-client-factory';
import { createAwsAccountDiscoveryApiClients } from './discovery-client-factory';
import {
  buildAwsAccountPermissionSummary,
  type AwsAccountDiscoveryApiClients,
} from './permission-validator';
import type { StsCredentialProvider } from './sts-credential-provider';
import type {
  AwsAccountDiscoveryResult,
  AwsAccountDiscoveryWarning,
  AwsAccountRoleConfig,
  StsAssumeRoleContext,
} from './sts-types';

export interface RunAwsAccountDiscoveryInput {
  registeredAccountId: string;
  region: string;
  roleConfig: AwsAccountRoleConfig;
  credentialProvider: StsCredentialProvider;
  stsContext: StsAssumeRoleContext;
  now?: () => Date;
  /** Injectable for unit tests — bypasses real SDK wiring when provided. */
  discoveryClients?: AwsAccountDiscoveryApiClients;
}

function isAccessDenied(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'AccessDenied' || name === 'AccessDeniedException';
}

function optionalWarningFromError(
  error: unknown,
  code: AwsAccountDiscoveryWarning['code'],
  message: string,
): AwsAccountDiscoveryWarning | undefined {
  if (isAccessDenied(error)) {
    return { code, message };
  }
  return undefined;
}

export async function runAwsAccountDiscovery(
  input: RunAwsAccountDiscoveryInput,
): Promise<AwsAccountDiscoveryResult> {
  const now = input.now ?? (() => new Date());
  const warnings: AwsAccountDiscoveryWarning[] = [];

  const assumed = await input.credentialProvider.getCredentials(
    input.roleConfig,
    input.stsContext,
  );

  const discoveryClients =
    input.discoveryClients ??
    createAwsAccountDiscoveryApiClients({
      region: input.region,
      credentials: assumed,
    });

  const identity = await discoveryClients.getCallerIdentity();

  const executionFactory = createAssumeRoleClientFactory(input.roleConfig, {
    credentialProvider: input.credentialProvider,
    auditContext: input.stsContext,
  });

  const permissionSummary = await buildAwsAccountPermissionSummary(
    executionFactory(input.region),
    discoveryClients,
  );

  let accountAlias: string | undefined;
  try {
    const aliases = await discoveryClients.listAccountAliases();
    accountAlias = aliases[0];
    if (aliases.length === 0) {
      warnings.push({
        code: 'ACCOUNT_ALIAS_UNAVAILABLE',
        message: 'No AWS account alias is configured for this account.',
      });
    }
  } catch (error) {
    const warning = optionalWarningFromError(
      error,
      'ACCOUNT_ALIAS_UNAVAILABLE',
      'Account alias discovery is unavailable for this role.',
    );
    if (warning) {
      warnings.push(warning);
    } else {
      throw error;
    }
  }

  let organizationId: string | undefined;
  try {
    organizationId = await discoveryClients.describeOrganizationId();
    if (!organizationId) {
      warnings.push({
        code: 'ORGANIZATION_UNAVAILABLE',
        message: 'This AWS account is not a member of an AWS Organization.',
      });
    }
  } catch (error) {
    const warning = optionalWarningFromError(
      error,
      'ORGANIZATION_ACCESS_DENIED',
      'Organization metadata is unavailable for this role.',
    );
    if (warning) {
      warnings.push(warning);
    } else {
      throw error;
    }
  }

  const enabledRegions = await discoveryClients.describeEnabledRegions();

  for (const optional of permissionSummary.optionalDiscoveryCapabilities) {
    if (optional.status === 'UNAVAILABLE') {
      warnings.push({
        code: 'OPTIONAL_CAPABILITY_UNAVAILABLE',
        message: `${optional.action} is unavailable (${optional.errorCode ?? 'unknown'}).`,
      });
    }
  }

  return {
    accountId: identity.accountId,
    principalArn: identity.principalArn,
    accountAlias,
    organizationId,
    enabledRegions,
    discoveredAt: now().toISOString(),
    permissionSummary,
    warnings,
  };
}

export function mapDiscoveryError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  const mapped = mapAwsError(error, 'aws-account-discovery');
  return new Error(mapped.message);
}
