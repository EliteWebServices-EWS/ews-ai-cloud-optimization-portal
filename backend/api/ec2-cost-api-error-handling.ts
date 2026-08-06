import { createLogger } from '../shared/utils/logger';
import { isAppError } from '../shared/utils';

const logger = createLogger('ec2-cost-api');

export const EC2_COST_PUBLIC_INTERNAL_ERROR_MESSAGE =
  'The EC2 cost analysis operation could not be completed.';

export interface Ec2CostInternalErrorLogContext {
  requestId: string;
  correlationId?: string;
  tenantId?: string;
  accountId?: string;
  operation: string;
  method?: string;
  path?: string;
}

export function logEc2CostInternalFailure(
  context: Ec2CostInternalErrorLogContext,
  error: unknown,
): void {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const internalMessage = error instanceof Error ? error.message : String(error);

  logger.error('EC2 cost API internal failure', {
    operation: context.operation,
    status: 'failure',
  });

  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      scope: 'ec2-cost-api',
      category: 'ec2-cost-api-internal',
      message: 'EC2 cost API internal failure',
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

export function resolveEc2CostAuditErrorCode(error: unknown): string {
  if (isAppError(error)) {
    return error.code;
  }
  if (error instanceof Error && error.name === 'RepositoryConflictError') {
    return 'CONFLICT';
  }
  return 'ENGINE_ERROR';
}
