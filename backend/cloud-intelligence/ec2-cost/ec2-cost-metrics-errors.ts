import { AppError } from '../../shared/utils';

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name: unknown }).name);
  }
  return '';
}

export function toEc2CostMetricsAppError(error: unknown): AppError {
  const name = errorName(error);
  if (name === 'AccessDenied' || name === 'AccessDeniedException') {
    return new AppError(
      'CLOUDWATCH_ACCESS_DENIED',
      'CloudWatch metrics access was denied for this AWS account.',
      403,
    );
  }
  if (
    name === 'Throttling' ||
    name === 'ThrottlingException' ||
    name === 'TooManyRequestsException'
  ) {
    return new AppError(
      'CLOUDWATCH_THROTTLED',
      'CloudWatch metrics request was throttled. Retry the analysis later.',
      429,
    );
  }
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(
    'CLOUDWATCH_METRICS_FAILED',
    'CloudWatch metrics could not be collected for this analysis.',
    502,
  );
}
