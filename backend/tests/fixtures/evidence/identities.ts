/** Canonical deterministic tenant/account/resource identities for evidence fixtures. */

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export const ACCOUNT_A = '111122223333';
export const ACCOUNT_B = '444455556666';

export const REGION = 'us-east-1';

export const RESOURCE_ID_A = 'i-abc';
export const RESOURCE_ID_B = 'i-other';
export const RESOURCE_ID_STOPPED = 'i-stopped';
export const RESOURCE_ID_CONFIDENCE_GOLDEN = 'i-confidence-001';

export const VOLUME_ID_A = 'vol-1';

export const EC2_CATEGORY_UNDERUTILIZED = 'UNDERUTILIZED';
export const EC2_CATEGORY_STOPPED_WITH_STORAGE = 'STOPPED_WITH_STORAGE';
export const EC2_RULE_VERSION = '1.0.0';
export const EC2_RULE_ID_UNDERUTILIZED = 'ec2-cost-underutilized';

export const FIXED_COLLECTED_AT = '2026-08-07T00:00:00.000Z';
export const FIXED_OBSERVATION_TS_1 = '2026-08-10T12:00:00.000Z';
export const FIXED_OBSERVATION_TS_2 = '2026-08-11T12:00:00.000Z';
export const FIXED_OBSERVATION_TS_3 = '2026-08-12T12:00:00.000Z';
export const FIXED_COLLECTION_TS_1 = '2026-08-10T12:05:00.000Z';
export const FIXED_COLLECTION_TS_2 = '2026-08-11T12:05:00.000Z';
export const FIXED_COLLECTION_TS_3 = '2026-08-12T12:05:00.000Z';

export interface EvidenceIdentity {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
}

export function buildEvidenceIdentity(
  overrides: Partial<EvidenceIdentity> = {},
): EvidenceIdentity {
  return {
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    region: REGION,
    resourceId: RESOURCE_ID_A,
    ...overrides,
  };
}
