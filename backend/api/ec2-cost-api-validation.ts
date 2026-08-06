import type { Ec2CostRecommendationListQuery } from '../repositories/contracts/ec2-cost-repository';
import {
  Ec2CostValidationError,
  validateObservationDays,
  type StartEc2CostAnalysisInput,
} from '../services/ec2-cost-analysis-api-service';
import {
  parseEc2CostAccountId,
  parseEc2CostCategoryFilter,
  parseEc2CostConfidenceLevelFilter,
  parseEc2CostLifecycleStatusFilter,
  parseEc2CostListLimit,
  parseEc2CostListNextToken,
  parseEc2CostRegion,
  parseEc2CostSeverityFilter,
} from './ec2-cost-request-validators';

export function parseEc2CostAnalysisBody(body: unknown): StartEc2CostAnalysisInput {
  if (!body || typeof body !== 'object') {
    throw new Ec2CostValidationError('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  const accountId = record.accountId;
  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    throw new Ec2CostValidationError('accountId is required.');
  }
  const normalizedAccountId = parseEc2CostAccountId(accountId);

  let regions: string[] | undefined;
  if (record.regions !== undefined) {
    if (!Array.isArray(record.regions)) {
      throw new Ec2CostValidationError('regions must be an array of region strings.');
    }
    regions = record.regions.map((r) => {
      if (typeof r !== 'string') {
        throw new Ec2CostValidationError('Each region must be a string.');
      }
      return parseEc2CostRegion(r);
    });
  }

  let observationDays: number | undefined;
  if (record.observationDays !== undefined) {
    if (typeof record.observationDays !== 'number') {
      throw new Ec2CostValidationError('observationDays must be a number.');
    }
    observationDays = validateObservationDays(record.observationDays);
  }

  return {
    accountId: normalizedAccountId,
    regions,
    observationDays,
  };
}

export function parseEc2CostRecommendationListQuery(
  tenantId: string,
  query: Record<string, unknown>,
): Ec2CostRecommendationListQuery {
  const accountId = query.accountId;
  if (typeof accountId !== 'string') {
    throw new Ec2CostValidationError('accountId query parameter is required.');
  }
  const normalizedAccountId = parseEc2CostAccountId(accountId);

  const parsed: Ec2CostRecommendationListQuery = {
    tenantId,
    accountId: normalizedAccountId,
  };

  if (typeof query.region === 'string' && query.region.length > 0) {
    parsed.region = parseEc2CostRegion(query.region);
  }
  if (typeof query.category === 'string' && query.category.length > 0) {
    parsed.category = parseEc2CostCategoryFilter(query.category);
  }
  if (typeof query.severity === 'string' && query.severity.length > 0) {
    parsed.severity = parseEc2CostSeverityFilter(query.severity);
  }
  if (typeof query.confidenceLevel === 'string' && query.confidenceLevel.length > 0) {
    parsed.confidenceLevel = parseEc2CostConfidenceLevelFilter(query.confidenceLevel);
  }
  if (typeof query.lifecycleStatus === 'string' && query.lifecycleStatus.length > 0) {
    parsed.lifecycleStatus = parseEc2CostLifecycleStatusFilter(query.lifecycleStatus);
  }
  if (typeof query.resourceId === 'string' && query.resourceId.length > 0) {
    parsed.resourceId = query.resourceId.trim();
  }
  if (query.limit !== undefined) {
    parsed.limit = parseEc2CostListLimit(query.limit);
  }
  if (typeof query.nextToken === 'string' && query.nextToken.length > 0) {
    parsed.nextToken = parseEc2CostListNextToken(query.nextToken);
  }
  return parsed;
}
