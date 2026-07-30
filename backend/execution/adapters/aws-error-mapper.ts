import { ExecutionAdapterError, type StructuredExecutionError } from './types';

export function mapAwsError(
  error: unknown,
  stage: string,
): StructuredExecutionError {
  if (error instanceof ExecutionAdapterError) {
    return error.toStructuredError();
  }

  const awsError = error as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };

  const message =
    awsError.message?.trim() ||
    (error instanceof Error ? error.message : 'Unknown AWS error');

  return {
    code: 'AWS_SDK_ERROR',
    message,
    stage,
    awsErrorName: awsError.name,
    retryable:
      awsError.name === 'ThrottlingException' ||
      awsError.name === 'RequestLimitExceeded',
  };
}

export function requireClient<T>(
  client: T | undefined,
  serviceName: string,
): T {
  if (!client) {
    throw new ExecutionAdapterError(
      'AWS_CLIENT_MISSING',
      `${serviceName} client is not configured.`,
      'validate',
    );
  }

  return client;
}
