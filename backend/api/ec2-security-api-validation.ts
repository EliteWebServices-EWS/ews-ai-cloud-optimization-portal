import type { Ec2SecurityFindingListQuery } from '../repositories/contracts/ec2-security-repository';
import {
  Ec2SecurityValidationError,
  type StartEc2SecurityAnalysisInput,
} from '../services/ec2-security-analysis-api-service';
import {
  parseEc2CostAccountId,
  parseEc2CostListLimit,
  parseEc2CostListNextToken,
  parseEc2CostRegion,
  parseEc2CostSeverityFilter,
} from './ec2-cost-request-validators';
import type { Ec2GovernancePolicy } from '../engines/ec2-security';

export function parseEc2SecurityAnalysisBody(body: unknown): StartEc2SecurityAnalysisInput {
  if (!body || typeof body !== 'object') {
    throw new Ec2SecurityValidationError('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  if ('tenantId' in record) {
    throw new Ec2SecurityValidationError('tenantId must not be supplied in the request body.');
  }
  if ('inventory' in record || 'findings' in record || 'securityScore' in record) {
    throw new Ec2SecurityValidationError('Request body contains unsupported fields.');
  }
  const accountId = record.accountId;
  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    throw new Ec2SecurityValidationError('accountId is required.');
  }
  const normalizedAccountId = parseEc2CostAccountId(accountId);

  let regions: string[] | undefined;
  if (record.regions !== undefined) {
    if (!Array.isArray(record.regions)) {
      throw new Ec2SecurityValidationError('regions must be an array of region strings.');
    }
    regions = record.regions.map((r) => {
      if (typeof r !== 'string') {
        throw new Ec2SecurityValidationError('Each region must be a string.');
      }
      return parseEc2CostRegion(r);
    });
  }

  let policy: Ec2GovernancePolicy | undefined;
  if (record.policy !== undefined) {
    if (typeof record.policy !== 'object' || record.policy === null) {
      throw new Ec2SecurityValidationError('policy must be an object when provided.');
    }
    policy = record.policy as Ec2GovernancePolicy;
  }

  return {
    accountId: normalizedAccountId,
    regions,
    policy,
  };
}

export function parseEc2SecurityFindingListQuery(
  tenantId: string,
  query: Record<string, unknown>,
): Ec2SecurityFindingListQuery {
  const accountId = query.accountId;
  if (typeof accountId !== 'string') {
    throw new Ec2SecurityValidationError('accountId query parameter is required.');
  }
  const parsed: Ec2SecurityFindingListQuery = {
    tenantId,
    accountId: parseEc2CostAccountId(accountId),
  };
  if (typeof query.region === 'string' && query.region.length > 0) {
    parsed.region = parseEc2CostRegion(query.region);
  }
  if (typeof query.severity === 'string' && query.severity.length > 0) {
    parsed.severity = parseEc2CostSeverityFilter(query.severity);
  }
  if (typeof query.category === 'string' && query.category.length > 0) {
    parsed.category = query.category;
  }
  if (typeof query.status === 'string' && query.status.length > 0) {
    parsed.status = query.status;
  }
  if (typeof query.resourceId === 'string' && query.resourceId.length > 0) {
    parsed.resourceId = query.resourceId;
  }
  if (query.limit !== undefined) {
    parsed.limit = parseEc2CostListLimit(query.limit);
  }
  if (typeof query.nextToken === 'string' && query.nextToken.length > 0) {
    parsed.nextToken = parseEc2CostListNextToken(query.nextToken);
  }
  return parsed;
}

export function parseEc2SecuritySummaryQuery(
  tenantId: string,
  query: Record<string, unknown>,
): { tenantId: string; accountId: string; region?: string } {
  const accountId = query.accountId;
  if (typeof accountId !== 'string') {
    throw new Ec2SecurityValidationError('accountId query parameter is required.');
  }
  const parsed: { tenantId: string; accountId: string; region?: string } = {
    tenantId,
    accountId: parseEc2CostAccountId(accountId),
  };
  if (typeof query.region === 'string' && query.region.trim().length > 0) {
    parsed.region = parseEc2CostRegion(query.region);
  }
  return parsed;
}
