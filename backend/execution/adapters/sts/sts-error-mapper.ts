import { StsProviderError } from './sts-types';

const RETRYABLE_ERROR_NAMES = new Set([
  'ThrottlingException',
  'RequestLimitExceeded',
  'ServiceUnavailable',
  'InternalFailure',
  'TimeoutError',
]);

// Trust-policy / configuration errors. Retrying will not help and can mask
// the real problem (wrong ExternalId, role does not trust this account,
// role does not exist). These must fail fast with a clear reason.
const PERMANENT_ERROR_NAMES = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'InvalidClientTokenId',
  'MalformedPolicyDocument',
  'PackedPolicyTooLarge',
  'RegionDisabledException',
  'NoSuchEntity',
]);

interface AwsSdkErrorShape {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

export function isRetryableStsError(error: unknown): boolean {
  if (error instanceof StsProviderError) {
    return error.retryable;
  }

  const awsError = error as AwsSdkErrorShape;
  if (awsError?.name && PERMANENT_ERROR_NAMES.has(awsError.name)) {
    return false;
  }
  if (awsError?.name && RETRYABLE_ERROR_NAMES.has(awsError.name)) {
    return true;
  }

  // Unrecognized errors (network blips, DNS failures) are treated as
  // transient so a single unexpected error class does not hard-fail a
  // credential refresh that would otherwise succeed on retry.
  return true;
}

export function mapStsError(error: unknown): StsProviderError {
  if (error instanceof StsProviderError) {
    return error;
  }

  const awsError = error as AwsSdkErrorShape;
  const message =
    awsError?.message?.trim() ||
    (error instanceof Error ? error.message : 'Unknown STS error');

  const name = awsError?.name ?? 'UnknownStsError';
  const retryable = isRetryableStsError(error);

  return new StsProviderError(
    name === 'AccessDenied' || name === 'AccessDeniedException'
      ? 'ASSUME_ROLE_ACCESS_DENIED'
      : `STS_${name}`,
    message,
    retryable,
    error,
  );
}
