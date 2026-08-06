import { requireKeyValue } from '../dynamodb-keys';
import { cloudResourceAccountPartitionKey } from './cloud-resource-keys';

export const EC2_COST_ANALYSIS_RUN_ENTITY = 'EC2_COST_ANALYSIS_RUN' as const;
export const EC2_COST_RECOMMENDATION_ENTITY = 'EC2_COST_RECOMMENDATION' as const;

export const EC2_COST_ANALYSIS_RUN_SK_PREFIX = `${EC2_COST_ANALYSIS_RUN_ENTITY}#`;
export const EC2_COST_RECOMMENDATION_SK_PREFIX = `${EC2_COST_RECOMMENDATION_ENTITY}#`;

export function ec2CostAnalysisRunSortKey(runId: string): string {
  return `${EC2_COST_ANALYSIS_RUN_SK_PREFIX}${requireKeyValue(runId, 'runId')}`;
}

export function ec2CostRecommendationSortKey(input: {
  region: string;
  category: string;
  resourceId: string;
  ruleVersion: string;
}): string {
  return `${EC2_COST_RECOMMENDATION_SK_PREFIX}${requireKeyValue(input.region, 'region')}#CAT#${requireKeyValue(
    input.category,
    'category',
  )}#RES#${requireKeyValue(input.resourceId, 'resourceId')}#RV#${requireKeyValue(
    input.ruleVersion,
    'ruleVersion',
  )}`;
}

export function ec2CostRecommendationSortKeyPrefixForAccount(): string {
  return EC2_COST_RECOMMENDATION_SK_PREFIX;
}

export function ec2CostAccountPartitionKey(tenantId: string, accountId: string): string {
  return cloudResourceAccountPartitionKey(tenantId, accountId);
}

export function buildEc2CostFindingKey(input: {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  category: string;
  ruleVersion: string;
}): string {
  return [
    input.tenantId,
    input.accountId,
    input.region,
    input.resourceId,
    input.category,
    input.ruleVersion,
  ].join('#');
}
