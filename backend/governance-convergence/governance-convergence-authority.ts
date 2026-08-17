import type {
  CloudResourceLifecycleStatus,
  Ec2DiscoveryRunStatus,
} from '../repositories/models/cloud-resource-persistence-models';
import type { Ec2SecurityAnalysisRunRecord } from '../cloud-intelligence/ec2-security/ec2-security-models';

export type GovernanceDiscoveryRunStatus = Ec2DiscoveryRunStatus | 'UNKNOWN';

export interface GovernanceRunAuthorityContext {
  requestedRegions: readonly string[];
  securityRunStatus: Ec2SecurityAnalysisRunRecord['status'];
  discoveryRunStatus: GovernanceDiscoveryRunStatus;
  discoveryRegionsSucceeded: readonly string[];
  discoveryRegionsFailed: readonly string[];
}

export interface GovernanceAbsenceAuthorityInput {
  requestedRegion: string;
  discoveryRegionsSucceeded: readonly string[];
  discoveryRegionsFailed: readonly string[];
  discoveryRunStatus: GovernanceDiscoveryRunStatus;
  securityRunStatus: Ec2SecurityAnalysisRunRecord['status'];
  resourceLifecycleStatus: CloudResourceLifecycleStatus;
}

/**
 * Explicit, unit-testable predicate for when a region/resource/control may be
 * evaluated for live governance MISSING. Requires both discovery and security
 * proof for the region; lifecycle must be ACTIVE.
 */
export function isAuthoritativeForGovernanceAbsence(
  input: GovernanceAbsenceAuthorityInput,
): boolean {
  if (input.resourceLifecycleStatus !== 'ACTIVE') {
    return false;
  }
  if (input.securityRunStatus !== 'SUCCEEDED') {
    return false;
  }
  if (input.discoveryRunStatus === 'UNKNOWN' || input.discoveryRunStatus === 'FAILED') {
    return false;
  }
  if (input.discoveryRegionsFailed.includes(input.requestedRegion)) {
    return false;
  }
  if (!input.discoveryRegionsSucceeded.includes(input.requestedRegion)) {
    return false;
  }
  return true;
}

/** Gate for any live MISSING reconciliation pass on a run. */
export function isRunAuthoritativeForMissingReconciliation(
  authority: GovernanceRunAuthorityContext,
): boolean {
  if (authority.securityRunStatus !== 'SUCCEEDED') {
    return false;
  }
  if (authority.discoveryRunStatus === 'UNKNOWN' || authority.discoveryRunStatus === 'FAILED') {
    return false;
  }
  return true;
}

export function authoritativeRegionsForGovernanceAbsence(
  authority: GovernanceRunAuthorityContext,
): string[] {
  if (!isRunAuthoritativeForMissingReconciliation(authority)) {
    return [];
  }
  const requested = new Set(authority.requestedRegions);
  return authority.discoveryRegionsSucceeded.filter(
    (region) =>
      requested.has(region) && !authority.discoveryRegionsFailed.includes(region),
  );
}
