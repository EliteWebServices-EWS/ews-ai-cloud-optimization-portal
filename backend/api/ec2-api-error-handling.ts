import { createLogger } from '../shared/utils/logger';
import { isAppError } from '../shared/utils';

const logger = createLogger('ec2-api');

/** Public message for unexpected EC2 API failures (never expose Error.message). */
export const EC2_PUBLIC_INTERNAL_ERROR_MESSAGE =
  'The EC2 discovery operation could not be completed.';

export interface Ec2InternalErrorLogContext {
  requestId: string;
  correlationId?: string;
  tenantId?: string;
  accountId?: string;
  operation: string;
  method?: string;
  path?: string;
}

/**
 * Records unexpected EC2 API failures for operators. Internal details stay off the wire.
 */
export function logEc2InternalFailure(
  context: Ec2InternalErrorLogContext,
  error: unknown,
): void {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const internalMessage = error instanceof Error ? error.message : String(error);

  logger.error('EC2 API internal failure', {
    operation: context.operation,
    status: 'failure',
  });

  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      scope: 'ec2-api',
      category: 'ec2-api-internal',
      message: 'EC2 API internal failure',
      requestId: context.requestId,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      accountId: context.accountId,
      operation: context.operation,
      method: context.method,
      path: context.path,
      errorName,
      internalMessage,
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    }),
  );
}

export function resolveEc2AuditErrorCode(error: unknown): string {
  if (isAppError(error)) {
    return error.code;
  }
  if (error instanceof Error && error.name === 'RepositoryConflictError') {
    return 'CONFLICT';
  }
  return 'ENGINE_ERROR';
}
