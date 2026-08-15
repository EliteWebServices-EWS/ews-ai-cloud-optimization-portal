import type { Logger } from '../../shared/utils';

export interface SafeAwsServiceErrorDetails {
  awsErrorName: string;
  awsHttpStatusCode?: number;
  awsRequestId?: string;
  awsRetryAttempts?: number;
}

interface AwsSdkErrorShape {
  name?: unknown;
  $metadata?: {
    httpStatusCode?: unknown;
    requestId?: unknown;
    attempts?: unknown;
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function readHttpStatusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 599) {
    return Math.trunc(value);
  }
  return undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.trunc(value);
  }
  return undefined;
}

export function safeAwsServiceErrorDetails(error: unknown): SafeAwsServiceErrorDetails {
  if (error === null || typeof error !== 'object') {
    return { awsErrorName: 'UnknownError' };
  }

  const aws = error as AwsSdkErrorShape;
  const awsErrorName =
    readNonEmptyString(aws.name) ??
    (error instanceof Error ? readNonEmptyString(error.name) : undefined) ??
    'UnknownError';

  const details: SafeAwsServiceErrorDetails = { awsErrorName };

  const httpStatusCode = readHttpStatusCode(aws.$metadata?.httpStatusCode);
  if (httpStatusCode !== undefined) {
    details.awsHttpStatusCode = httpStatusCode;
  }

  const requestId = readNonEmptyString(aws.$metadata?.requestId);
  if (requestId !== undefined) {
    details.awsRequestId = requestId;
  }

  const attempts = readPositiveInteger(aws.$metadata?.attempts);
  if (attempts !== undefined) {
    details.awsRetryAttempts = attempts;
  }

  return details;
}

export function logEc2CostCloudWatchMetricsFailure(
  logger: Logger,
  context: {
    operation: string;
    region: string;
    tenantId: string;
    accountId: string;
    mappedCode: string;
  },
  error: unknown,
): void {
  const aws = safeAwsServiceErrorDetails(error);
  logger.error('CloudWatch metric collection failed', {
    operation: context.operation,
    region: context.region,
    tenantId: context.tenantId,
    accountId: context.accountId,
    mappedCode: context.mappedCode,
    awsErrorName: aws.awsErrorName,
    awsHttpStatusCode: aws.awsHttpStatusCode,
    awsRequestId: aws.awsRequestId,
    awsRetryAttempts: aws.awsRetryAttempts,
  });
}
