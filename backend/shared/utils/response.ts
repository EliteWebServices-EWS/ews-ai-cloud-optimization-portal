import { createHash, randomBytes } from 'node:crypto';

import { API_VERSION } from '../constants';

export interface ApiMetadata {
  requestId: string;
  timestamp: string;
  version: string;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  metadata: ApiMetadata;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    stage?: string;
  };
  metadata: ApiMetadata;
}

/** Build a standardized success API response. */
export function buildSuccessResponse<T>(
  data: T,
  requestId: string
): SuccessResponse<T> {
  return {
    success: true,
    data,
    metadata: {
      requestId,
      timestamp: new Date().toISOString(),
      version: API_VERSION,
    },
  };
}

/** Build a standardized error API response. */
export function buildErrorResponse(
  code: string,
  message: string,
  requestId: string,
  stage?: string
): ErrorResponse {
  return {
    success: false,
    error: { code, message, stage },
    metadata: {
      requestId,
      timestamp: new Date().toISOString(),
      version: API_VERSION,
    },
  };
}

/** Generate a unique request identifier. */
export function generateRequestId(prefix = 'req'): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

/** Generate a unique workflow identifier.
 * Includes a random suffix (not just a timestamp) so concurrent Lambda
 * invocations in the same millisecond cannot generate colliding IDs. */
export function generateWorkflowId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `wf-${timestamp}-${randomSuffix}`;
}

/** Generate a unique execution identifier. */
export function generateExecutionId(): string {
  return `exec-${Date.now().toString(36)}`;
}

/**
 * Derive a deterministic workflow identifier from a tenant + client-supplied
 * idempotency key. Two requests from the same tenant with the same
 * idempotency key always resolve to the same workflowId, which lets the
 * repository's conditional create (attribute_not_exists) act as the single
 * source of truth for duplicate detection — including under concurrent
 * Lambda invocations racing to create the same logical workflow.
 */
export function deriveIdempotentWorkflowId(
  tenantId: string,
  idempotencyKey: string
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);

  return `wf-idem-${digest}`;
}

/** Deterministic async job id for a tenant + client idempotency key. */
export function deriveIdempotentAsyncJobId(
  tenantId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`async-job:${tenantId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);

  return `job-idem-${digest}`;
}

export function generateAsyncJobId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `job-${timestamp}-${randomSuffix}`;
}

/** Deterministic report id for a tenant-scoped EC2 async intelligence job. */
export function deriveEc2AsyncReportId(tenantId: string, jobId: string): string {
  const digest = createHash('sha256')
    .update(`ec2-async-report:${tenantId}:${jobId}`)
    .digest('hex')
    .slice(0, 32);

  return `rpt-ec2-async-${digest}`;
}

/** Generate a unique optimization report identifier. */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `rpt-${timestamp}-${randomSuffix}`;
}

/** Generate a unique tenant identifier. */
export function generateTenantId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `tenant-${timestamp}-${randomSuffix}`;
}

/**
 * Generate a cryptographically random AssumeRole external ID.
 *
 * The tenant embeds this in their IAM role's trust policy to prevent the
 * confused-deputy problem (see StsProviderError EXTERNAL_ID_REQUIRED in
 * execution/adapters/sts, which refuses to AssumeRole without one). High
 * entropy, no client input, drawn from a CSPRNG (crypto.randomBytes) —
 * Math.random() is not cryptographically secure and must never back a
 * security credential.
 */
export function generateExternalId(): string {
  return randomBytes(32).toString('hex');
}
