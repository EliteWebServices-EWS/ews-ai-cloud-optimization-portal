export {
  StsCredentialProvider,
  createStsCredentialProvider,
  type StsCredentialProviderDeps,
} from './sts-credential-provider';
export {
  createAssumeRoleClientFactory,
  withAccessDeniedRecovery,
} from './aws-service-client-factory';
export {
  validateRequiredPermissions,
  buildAwsAccountPermissionSummary,
  assertSessionNotExpired,
  type AwsAccountDiscoveryApiClients,
} from './permission-validator';
export { runAwsAccountDiscovery, mapDiscoveryError } from './aws-account-discovery';
export { createAwsAccountDiscoveryApiClients } from './discovery-client-factory';
export { mapStsError, isRetryableStsError } from './sts-error-mapper';
export { withRetry, withTimeout, type RetryOptions } from './retry';
export {
  StsProviderError,
  validateRoleConfig,
  type AwsAccountRoleConfig,
  type AssumedCredentials,
  type StsAssumeRoleContext,
  type PermissionCheckResult,
  type PermissionValidationReport,
  type AwsAccountDiscoveryResult,
  type AwsAccountDiscoveryMetadata,
  type AwsAccountPermissionSummary,
} from './sts-types';
