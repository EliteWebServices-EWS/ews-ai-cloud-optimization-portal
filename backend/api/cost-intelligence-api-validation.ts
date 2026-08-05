import { AppError } from '../shared/utils';
import { COST_FINDING_STATUS, type CostFindingStatus } from '../shared/constants';

const ACCOUNT_ID_PATTERN = /^\d{12}$/;
const FINDING_STATUSES: readonly CostFindingStatus[] = [
  COST_FINDING_STATUS.OPEN,
  COST_FINDING_STATUS.ACKNOWLEDGED,
  COST_FINDING_STATUS.RESOLVED,
  COST_FINDING_STATUS.DISMISSED,
];

export class CostIntelligenceApiValidationError extends AppError {
  constructor(message: string) {
    super('INVALID_REQUEST', message, 422, 'cost-intelligence-api');
    this.name = 'CostIntelligenceApiValidationError';
  }
}

function assertPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CostIntelligenceApiValidationError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export interface RunCostAnalysisBody {
  accountId: string;
}

export function validateRunCostAnalysisBody(body: unknown): RunCostAnalysisBody {
  const record = assertPlainObject(body, 'body');

  if (typeof record.accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(record.accountId)) {
    throw new CostIntelligenceApiValidationError(
      'accountId is required and must be a 12-digit AWS account ID.',
    );
  }

  return { accountId: record.accountId };
}

export interface CostFindingListQuery {
  limit?: number;
  nextToken?: string;
  accountId?: string;
}

export function parseCostFindingListQuery(
  query: Record<string, unknown>,
): CostFindingListQuery {
  const limitRaw = query.limit;
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new CostIntelligenceApiValidationError('limit must be an integer between 1 and 100.');
    }
  }

  const accountId =
    typeof query.accountId === 'string' && query.accountId.trim()
      ? query.accountId.trim()
      : undefined;

  if (accountId && !ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new CostIntelligenceApiValidationError('accountId must be a 12-digit AWS account ID.');
  }

  return {
    limit,
    nextToken:
      typeof query.nextToken === 'string' && query.nextToken.trim()
        ? query.nextToken.trim()
        : undefined,
    accountId,
  };
}

export function validateExpectedVersionQuery(value: unknown): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new CostIntelligenceApiValidationError(
      'expectedVersion is required and must be a positive integer.',
    );
  }
  return version;
}

export function validateUpdateFindingStatusBody(body: unknown): {
  status: CostFindingStatus;
  expectedVersion: number;
} {
  const record = assertPlainObject(body, 'body');

  if (typeof record.status !== 'string' || !FINDING_STATUSES.includes(record.status as CostFindingStatus)) {
    throw new CostIntelligenceApiValidationError(
      `status is required and must be one of: ${FINDING_STATUSES.join(', ')}.`,
    );
  }

  return {
    status: record.status as CostFindingStatus,
    expectedVersion: validateExpectedVersionQuery(record.expectedVersion),
  };
}
