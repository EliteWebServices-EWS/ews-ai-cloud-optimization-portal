import { RepositoryNotFoundError } from '../database';
import { isAppError } from '../shared/utils';
import { Ec2CostValidationError } from '../services/ec2-cost-analysis-api-service';
import { Ec2SecurityValidationError } from '../services/ec2-security-analysis-api-service';

export function resolveEc2SecurityAuditStatusCode(error: unknown): number {
  if (error instanceof Ec2SecurityValidationError || error instanceof Ec2CostValidationError) {
    return 422;
  }
  if (error instanceof RepositoryNotFoundError) {
    return 404;
  }
  if (isAppError(error)) {
    return error.statusCode;
  }
  return 500;
}

export function resolveEc2SecurityAuditErrorCode(error: unknown): string {
  if (error instanceof Ec2SecurityValidationError || error instanceof Ec2CostValidationError) {
    return 'INVALID_REQUEST';
  }
  if (error instanceof RepositoryNotFoundError) {
    return 'NOT_FOUND';
  }
  if (isAppError(error)) {
    return error.code;
  }
  return 'ENGINE_ERROR';
}
