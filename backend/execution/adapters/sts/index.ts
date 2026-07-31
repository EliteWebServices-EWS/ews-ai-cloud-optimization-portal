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
  assertSessionNotExpired,
} from './permission-validator';
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
} from './sts-types';
