import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';

/** Persisted on VOLUME metadata.attachments[] after EC2 discovery (Engineer 1). */
export interface PersistedEc2VolumeAttachment {
  instanceId: string;
  deviceName?: string;
  state?: string;
  attachTime?: string;
  deleteOnTermination?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPersistedVolumeAttachments(
  metadata: Record<string, unknown>,
): PersistedEc2VolumeAttachment[] {
  const raw = metadata.attachments;
  if (!Array.isArray(raw)) {
    return readLegacyAttachmentFields(metadata);
  }
  const parsed: PersistedEc2VolumeAttachment[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const instanceId = item.instanceId;
    if (typeof instanceId !== 'string' || instanceId.trim().length === 0) {
      continue;
    }
    parsed.push({
      instanceId,
      deviceName: typeof item.deviceName === 'string' ? item.deviceName : undefined,
      state: typeof item.state === 'string' ? item.state : undefined,
      attachTime: typeof item.attachTime === 'string' ? item.attachTime : undefined,
      deleteOnTermination:
        typeof item.deleteOnTermination === 'boolean' ? item.deleteOnTermination : undefined,
    });
  }
  return parsed;
}

function readLegacyAttachmentFields(
  metadata: Record<string, unknown>,
): PersistedEc2VolumeAttachment[] {
  const legacyIds = metadata.attachedInstanceIds;
  if (Array.isArray(legacyIds)) {
    return legacyIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((instanceId) => ({ instanceId, state: 'attached' }));
  }
  const single = metadata.attachedInstanceId;
  if (typeof single === 'string' && single.length > 0) {
    return [{ instanceId: single, state: 'attached' }];
  }
  return [];
}

export function volumeHasAttachmentMetadata(metadata: Record<string, unknown>): boolean {
  return readPersistedVolumeAttachments(metadata).length > 0;
}

function isAttachedState(state: string | undefined): boolean {
  if (!state) {
    return true;
  }
  return state.toLowerCase() === 'attached';
}

export function isVolumeAttachedToInstance(
  volume: DiscoveredCloudResourceRecord,
  instanceId: string,
): boolean {
  const attachments = readPersistedVolumeAttachments(volume.metadata);
  return attachments.some(
    (a) => a.instanceId === instanceId && isAttachedState(a.state),
  );
}

export function volumesAttachedToInstance(
  volumes: DiscoveredCloudResourceRecord[],
  instanceId: string,
): DiscoveredCloudResourceRecord[] {
  return volumes.filter(
    (v) => v.resourceType === 'VOLUME' && v.status === 'ACTIVE' && isVolumeAttachedToInstance(v, instanceId),
  );
}

/** Volumes that appear in-use but lack attachment metadata (cannot link safely). */
export function volumesInUseWithoutAttachmentMetadata(
  volumes: DiscoveredCloudResourceRecord[],
): DiscoveredCloudResourceRecord[] {
  return volumes.filter((v) => {
    if (v.resourceType !== 'VOLUME' || v.status !== 'ACTIVE') {
      return false;
    }
    const state = String(v.metadata.state ?? '').toLowerCase();
    if (state !== 'in-use') {
      return false;
    }
    return !volumeHasAttachmentMetadata(v.metadata);
  });
}
