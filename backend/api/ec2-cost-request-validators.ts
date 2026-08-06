import {
  EC2_COST_RECOMMENDATION_CATEGORIES,
  type Ec2CostConfidenceLevel,
  type Ec2CostLifecycleStatus,
  type Ec2CostRecommendationCategory,
  type Ec2CostRecommendationSeverity,
} from '../cloud-intelligence/ec2-cost/ec2-cost-models';
import { EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH } from '../repositories/ec2-cost-recommendation-pagination';
import {
  validateCloudResourceAccountId,
  validateCloudResourceRegion,
} from '../repositories/models/cloud-resource-persistence-models';
import { Ec2CostValidationError } from '../services/ec2-cost-analysis-api-service';

const EC2_COST_RECOMMENDATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const SEVERITIES: readonly Ec2CostRecommendationSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
const CONFIDENCE_LEVELS: readonly Ec2CostConfidenceLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const LIFECYCLE_STATUSES: readonly Ec2CostLifecycleStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'DISMISSED',
  'RESOLVED',
];

export function parseEc2CostAccountId(accountId: string): string {
  try {
    return validateCloudResourceAccountId(accountId);
  } catch {
    throw new Ec2CostValidationError('accountId must be a valid 12-digit AWS account ID.');
  }
}

export function parseEc2CostRegion(region: string): string {
  const trimmed = region.trim();
  try {
    return validateCloudResourceRegion(trimmed);
  } catch {
    throw new Ec2CostValidationError(`Invalid AWS region: ${trimmed}`);
  }
}

export function parseEc2CostRecommendationId(recommendationId: string): string {
  const trimmed = recommendationId.trim();
  if (!EC2_COST_RECOMMENDATION_ID_PATTERN.test(trimmed)) {
    throw new Ec2CostValidationError('recommendationId is invalid.');
  }
  return trimmed;
}

function parseEnumFilter<T extends string>(
  value: string,
  allowed: readonly T[],
  fieldName: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Ec2CostValidationError(`Invalid ${fieldName} filter.`);
  }
  return value as T;
}

export function parseEc2CostCategoryFilter(value: string): Ec2CostRecommendationCategory {
  return parseEnumFilter(value, EC2_COST_RECOMMENDATION_CATEGORIES, 'category');
}

export function parseEc2CostSeverityFilter(value: string): Ec2CostRecommendationSeverity {
  return parseEnumFilter(value, SEVERITIES, 'severity');
}

export function parseEc2CostConfidenceLevelFilter(value: string): Ec2CostConfidenceLevel {
  return parseEnumFilter(value, CONFIDENCE_LEVELS, 'confidenceLevel');
}

export function parseEc2CostLifecycleStatusFilter(value: string): Ec2CostLifecycleStatus {
  return parseEnumFilter(value, LIFECYCLE_STATUSES, 'lifecycleStatus');
}

export function parseEc2CostListLimit(raw: unknown): number {
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Ec2CostValidationError('limit must be an integer between 1 and 100.');
  }
  return limit;
}

export function parseEc2CostListNextToken(raw: string): string {
  const token = raw.trim();
  if (token.length === 0) {
    throw new Ec2CostValidationError('Pagination token is invalid or not valid for this list.');
  }
  if (token.length > EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH) {
    throw new Ec2CostValidationError('Pagination token is invalid or not valid for this list.');
  }
  return token;
}
