import type { MockEc2CloudResourceRepository } from '../../../repositories/mock/mock-ec2-cloud-resource-repository';
import {
  ACCOUNT_A,
  EC2_CATEGORY_STOPPED_WITH_STORAGE,
  EC2_RULE_VERSION,
  REGION,
  RESOURCE_ID_STOPPED,
  TENANT_A,
  VOLUME_ID_A,
} from './identities';
import { buildEvidenceIdentity } from './identities';
import { buildEc2FindingKeyForIdentity } from './observation-builders';

export async function seedStoppedInstanceWithVolume(
  resources: MockEc2CloudResourceRepository,
  identity = buildEvidenceIdentity({ resourceId: RESOURCE_ID_STOPPED }),
  discoveredAt = '2026-08-10T10:00:00.000Z',
): Promise<void> {
  await resources.upsertDiscoveredResource({
    tenantId: identity.tenantId,
    accountId: identity.accountId,
    region: identity.region,
    resourceType: 'INSTANCE',
    resourceId: identity.resourceId,
    tags: [],
    status: 'ACTIVE',
    metadata: { state: 'stopped' },
    discoveredAt,
  });
  await resources.upsertDiscoveredResource({
    tenantId: identity.tenantId,
    accountId: identity.accountId,
    region: identity.region,
    resourceType: 'VOLUME',
    resourceId: VOLUME_ID_A,
    tags: [],
    status: 'ACTIVE',
    metadata: {
      sizeGiB: 50,
      volumeType: 'gp3',
      attachments: [{ instanceId: identity.resourceId, state: 'attached' }],
    },
    discoveredAt,
  });
}

export function buildStoppedInstanceFindingKey(
  tenantId = TENANT_A,
  accountId = ACCOUNT_A,
): string {
  return buildEc2FindingKeyForIdentity(
    { tenantId, accountId, region: REGION, resourceId: RESOURCE_ID_STOPPED },
    EC2_CATEGORY_STOPPED_WITH_STORAGE,
    EC2_RULE_VERSION,
  );
}

export function buildEmptyMetricsFactory() {
  return () => ({
    collectMetrics: async () => [],
  });
}
