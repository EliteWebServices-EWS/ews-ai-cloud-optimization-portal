import type { Ec2ResourceType } from '../repositories/models/cloud-resource-persistence-models';
import {
  validateCloudResourceAccountId,
  validateCloudResourceRegion,
  validateEc2ResourceType,
} from '../repositories/models/cloud-resource-persistence-models';
import type { Ec2ResourceListQuery } from '../repositories/contracts/ec2-cloud-resource-repository';
import { normalizePageSize } from '../repositories/contracts/repository-types';
import { Ec2DiscoveryValidationError } from '../services/ec2-discovery-api-service';

export function parseEc2DiscoveryBody(body: unknown): { regions?: string[] } {
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new Ec2DiscoveryValidationError('Request body must be an object.');
  }
  const record = body as Record<string, unknown>;
  if (record.regions === undefined) {
    return {};
  }
  if (!Array.isArray(record.regions)) {
    throw new Ec2DiscoveryValidationError('regions must be an array of strings.');
  }
  const regions = record.regions.map((value) => {
    if (typeof value !== 'string') {
      throw new Ec2DiscoveryValidationError('regions must contain only strings.');
    }
    try {
      return validateCloudResourceRegion(value);
    } catch {
      throw new Ec2DiscoveryValidationError(`Invalid AWS region: ${value}`);
    }
  });
  return { regions };
}

export function parseEc2ResourceListQuery(
  query: Record<string, unknown>,
  tenantId: string,
  options: { requireAccountId: boolean },
): Ec2ResourceListQuery {
  const accountIdRaw = query.accountId;
  if (options.requireAccountId) {
    if (typeof accountIdRaw !== 'string') {
      throw new Ec2DiscoveryValidationError('Query parameter accountId is required.');
    }
  }
  const accountId =
    typeof accountIdRaw === 'string'
      ? validateCloudResourceAccountId(accountIdRaw)
      : '';

  const region =
    typeof query.region === 'string' && query.region.trim()
      ? validateCloudResourceRegion(query.region)
      : undefined;

  let resourceType: Ec2ResourceType | undefined;
  if (typeof query.resourceType === 'string' && query.resourceType.trim()) {
    try {
      resourceType = validateEc2ResourceType(query.resourceType);
    } catch {
      throw new Ec2DiscoveryValidationError(`Invalid EC2 resourceType: ${query.resourceType}`);
    }
  }

  const status =
    typeof query.status === 'string' &&
    (query.status === 'ACTIVE' || query.status === 'NOT_SEEN' || query.status === 'STALE')
      ? query.status
      : undefined;

  let limit: number | undefined;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Ec2DiscoveryValidationError('limit must be a positive integer.');
    }
    limit = normalizePageSize(parsed);
  }

  const nextToken =
    typeof query.nextToken === 'string' && query.nextToken.trim()
      ? query.nextToken.trim()
      : undefined;

  return {
    tenantId,
    accountId,
    region,
    resourceType,
    status,
    limit,
    nextToken,
  };
}
