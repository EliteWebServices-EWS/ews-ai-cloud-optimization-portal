import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';
import type { Ec2SecurityInventoryItem } from '../../engines/ec2-security';
import {
  mapPersistedSecurityGroups,
  resolveMetadataHttpTokens,
} from './ec2-security-evidence';

function tagsToRecord(tags: Array<{ key: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags) {
    out[tag.key] = tag.value;
  }
  return out;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function metadataBoolean(metadata: Record<string, unknown>, key: string): boolean | undefined {
  const value = metadata[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function mapDiscoveredInstanceToSecurityInventory(
  instance: DiscoveredCloudResourceRecord,
  volumesForInstance: DiscoveredCloudResourceRecord[],
): Ec2SecurityInventoryItem {
  const metadata = instance.metadata ?? {};
  const monitoringState = metadataString(metadata, 'monitoringState');
  const securityGroups = mapPersistedSecurityGroups(metadata);
  const metadataHttpTokens = resolveMetadataHttpTokens(metadata);

  const ebsVolumes = volumesForInstance.map((volume) => ({
    volumeId: volume.resourceId,
    encrypted: metadataBoolean(volume.metadata ?? {}, 'encrypted'),
  }));

  return {
    instanceId: instance.resourceId,
    instanceType: metadataString(metadata, 'instanceType') ?? 'unknown',
    state: metadataString(metadata, 'state'),
    region: instance.region,
    launchTime: metadataString(metadata, 'launchTime'),
    tags: tagsToRecord(instance.tags),
    publicIpAddress: metadataString(metadata, 'publicIpAddress'),
    securityGroups,
    ebsVolumes,
    iamInstanceProfileArn: metadataString(metadata, 'iamInstanceProfileArn'),
    metadataHttpTokens,
    cloudWatchMonitoring: monitoringState?.toLowerCase() === 'enabled',
    backupPolicy:
      typeof metadata.backupPolicy === 'object' && metadata.backupPolicy !== null
        ? (metadata.backupPolicy as { enabled?: boolean; lastBackupAt?: string })
        : undefined,
  };
}

export function indexVolumesByInstance(
  volumes: DiscoveredCloudResourceRecord[],
): Map<string, DiscoveredCloudResourceRecord[]> {
  const map = new Map<string, DiscoveredCloudResourceRecord[]>();
  for (const volume of volumes) {
    const attachments = volume.metadata?.attachments;
    if (!Array.isArray(attachments)) {
      continue;
    }
    for (const attachment of attachments) {
      if (
        typeof attachment === 'object' &&
        attachment !== null &&
        typeof (attachment as { instanceId?: unknown }).instanceId === 'string'
      ) {
        const instanceId = (attachment as { instanceId: string }).instanceId;
        const list = map.get(instanceId) ?? [];
        list.push(volume);
        map.set(instanceId, list);
      }
    }
    const attachedIds = volume.metadata?.attachedInstanceIds;
    if (Array.isArray(attachedIds)) {
      for (const instanceId of attachedIds) {
        if (typeof instanceId !== 'string') {
          continue;
        }
        const list = map.get(instanceId) ?? [];
        if (!list.some((v) => v.resourceId === volume.resourceId)) {
          list.push(volume);
          map.set(instanceId, list);
        }
      }
    }
  }
  return map;
}

export function computeComplianceScore(securityScore: number, governanceScore: number): number {
  return Math.round((securityScore + governanceScore) / 2);
}
