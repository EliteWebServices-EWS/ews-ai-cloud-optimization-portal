import type { Logger, LogContext } from '../shared/utils';
import { RepositoryConflictError } from '../database';
import { isRetryableConsumerError } from './ec2-async-job-consumer-errors';
import { Ec2StageRunActiveLeaseError } from '../repositories/ec2-stage-run-execution-claim';

export type Ec2ConsumerDiscoveryOperation =
  | 'discovery_proof_load'
  | 'discovery_execution_claim'
  | 'discovery_run_create'
  | 'discovery_start'
  | 'discovery_assume_role_or_client'
  | 'discovery_plugin'
  | 'discovery_persist'
  | 'discovery_complete';

export interface Ec2ConsumerStageDiagnosticContext {
  jobId: string;
  tenantId: string;
  accountId: string;
  stage: string;
  correlationId?: string;
  requestId?: string;
  runId?: string;
}

export interface SafeConsumerErrorDetails {
  errorName: string;
  awsErrorCode?: string;
  httpStatusCode?: number;
  awsRequestId?: string;
  retryable: boolean;
}

interface AwsLikeError extends Error {
  Code?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number; requestId?: string };
}

const SENSITIVE_LOG_PATTERN =
  /(?:AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|externalId|ExternalId|sessionToken|SessionToken|SecretAccessKey|accessKeyId|Authorization:\s*\S+)/i;

export function isSafeForConsumerDiagnosticLog(value: string): boolean {
  return !SENSITIVE_LOG_PATTERN.test(value);
}

export function safeConsumerErrorDetails(error: unknown): SafeConsumerErrorDetails {
  const retryable =
    isRetryableConsumerError(error) ||
    error instanceof RepositoryConflictError ||
    error instanceof Ec2StageRunActiveLeaseError;

  if (!(error instanceof Error)) {
    return { errorName: 'UnknownError', retryable: false };
  }

  const aws = error as AwsLikeError;
  const awsErrorCode =
    typeof aws.Code === 'string'
      ? aws.Code
      : typeof aws.code === 'string'
        ? aws.code
        : undefined;

  return {
    errorName: error.name || 'Error',
    awsErrorCode,
    httpStatusCode: aws.$metadata?.httpStatusCode,
    awsRequestId: aws.$metadata?.requestId,
    retryable,
  };
}

export function logEc2ConsumerStageDiagnostic(
  logger: Logger,
  level: 'info' | 'warn' | 'error',
  message: string,
  stageContext: Ec2ConsumerStageDiagnosticContext,
  operation: Ec2ConsumerDiscoveryOperation,
  extra?: Partial<LogContext>,
): void {
  const context: LogContext = {
    stage: stageContext.stage,
    operation,
    jobId: stageContext.jobId,
    tenantId: stageContext.tenantId,
    accountId: stageContext.accountId,
    ...extra,
  };
  if (stageContext.correlationId) {
    context.correlationId = stageContext.correlationId;
  }
  if (stageContext.requestId) {
    context.requestId = stageContext.requestId;
  }
  if (stageContext.runId) {
    context.runId = stageContext.runId;
  }
  logger[level](message, context);
}

export function logEc2ConsumerStageFailure(
  logger: Logger,
  stageContext: Ec2ConsumerStageDiagnosticContext,
  operation: Ec2ConsumerDiscoveryOperation,
  error: unknown,
): void {
  const details = safeConsumerErrorDetails(error);
  logEc2ConsumerStageDiagnostic(
    logger,
    'error',
    'ec2.async_job_stage_failed',
    stageContext,
    operation,
    {
      status: 'failed',
      errorName: details.errorName,
      awsErrorCode: details.awsErrorCode,
      httpStatusCode: details.httpStatusCode,
      awsRequestId: details.awsRequestId,
      retryable: details.retryable,
    },
  );
}
