import { createHash } from 'node:crypto';

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

/** Generate a unique optimization report identifier. */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `rpt-${timestamp}-${randomSuffix}`;
}
