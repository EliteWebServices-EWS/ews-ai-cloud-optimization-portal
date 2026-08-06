import { requireKeyValue } from '../dynamodb-keys';
import { cloudResourceAccountPartitionKey } from './cloud-resource-keys';

export const EC2_SECURITY_ANALYSIS_RUN_ENTITY = 'EC2_SECURITY_ANALYSIS_RUN' as const;
export const EC2_SECURITY_FINDING_ENTITY = 'EC2_SECURITY_FINDING' as const;
export const EC2_SECURITY_SUMMARY_ENTITY = 'EC2_SECURITY_SUMMARY' as const;

export const EC2_SECURITY_ANALYSIS_RUN_SK_PREFIX = `${EC2_SECURITY_ANALYSIS_RUN_ENTITY}#`;
export const EC2_SECURITY_FINDING_SK_PREFIX = `${EC2_SECURITY_FINDING_ENTITY}#`;
export const EC2_SECURITY_SUMMARY_SK_PREFIX = `${EC2_SECURITY_SUMMARY_ENTITY}#`;

export function ec2SecurityAnalysisRunSortKey(runId: string): string {
  return `${EC2_SECURITY_ANALYSIS_RUN_SK_PREFIX}${requireKeyValue(runId, 'runId')}`;
}

export const EC2_SECURITY_RULE_VERSION = '1' as const;

export function ec2SecurityFindingSortKey(input: {
  region: string;
  resourceId: string;
  check: string;
  ruleVersion?: string;
}): string {
  const ruleVersion = input.ruleVersion ?? EC2_SECURITY_RULE_VERSION;
  return `${EC2_SECURITY_FINDING_SK_PREFIX}${requireKeyValue(input.region, 'region')}#RES#${requireKeyValue(
    input.resourceId,
    'resourceId',
  )}#CHK#${requireKeyValue(input.check, 'check')}#RV#${requireKeyValue(ruleVersion, 'ruleVersion')}`;
}

export function ec2SecuritySummarySortKey(region: string): string {
  return `${EC2_SECURITY_SUMMARY_SK_PREFIX}${requireKeyValue(region, 'region')}`;
}

export function buildEc2SecurityFindingKey(input: {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  check: string;
  ruleVersion?: string;
}): string {
  const ruleVersion = input.ruleVersion ?? EC2_SECURITY_RULE_VERSION;
  return `${input.tenantId}#${input.accountId}#${input.region}#${input.resourceId}#${input.check}#${ruleVersion}`;
}

export function parseEc2SecurityFindingKey(findingKey: string): {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  check: string;
  ruleVersion: string;
} | null {
  const segments = findingKey.split('#');
  if (segments.length < 6) {
    return null;
  }
  const ruleVersion = segments.pop();
  const check = segments.pop();
  const resourceId = segments.pop();
  const region = segments.pop();
  const accountId = segments.pop();
  const tenantId = segments.join('#');
  if (!tenantId || !accountId || !region || !resourceId || !check || !ruleVersion) {
    return null;
  }
  return { tenantId, accountId, region, resourceId, check, ruleVersion };
}

export function ec2SecurityAccountPartitionKey(tenantId: string, accountId: string): string {
  return cloudResourceAccountPartitionKey(tenantId, accountId);
}

export function ec2SecurityFindingSortKeyPrefixForAccount(): string {
  return EC2_SECURITY_FINDING_SK_PREFIX;
}

export function ec2SecuritySummarySortKeyPrefixForAccount(): string {
  return EC2_SECURITY_SUMMARY_SK_PREFIX;
}
