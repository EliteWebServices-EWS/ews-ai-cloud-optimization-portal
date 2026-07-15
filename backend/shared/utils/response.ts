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

/** Generate a unique workflow identifier. */
export function generateWorkflowId(): string {
  return `wf-${Date.now().toString(36)}`;
}

/** Generate a unique execution identifier. */
export function generateExecutionId(): string {
  return `exec-${Date.now().toString(36)}`;
}

/** Generate a unique optimization report identifier. */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `rpt-${timestamp}-${randomSuffix}`;
}
