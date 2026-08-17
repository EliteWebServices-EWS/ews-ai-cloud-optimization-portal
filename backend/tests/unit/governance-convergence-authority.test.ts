import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  authoritativeRegionsForGovernanceAbsence,
  isAuthoritativeForGovernanceAbsence,
  isRunAuthoritativeForMissingReconciliation,
  type GovernanceRunAuthorityContext,
} from '../../governance-convergence/governance-convergence-authority';

function authority(overrides: Partial<GovernanceRunAuthorityContext> = {}): GovernanceRunAuthorityContext {
  return {
    requestedRegions: ['us-east-1'],
    securityRunStatus: 'SUCCEEDED',
    discoveryRunStatus: 'SUCCEEDED',
    discoveryRegionsSucceeded: ['us-east-1'],
    discoveryRegionsFailed: [],
    ...overrides,
  };
}

describe('governance convergence authority', () => {
  it('requires ACTIVE lifecycle for governance absence inference', () => {
    assert.equal(
      isAuthoritativeForGovernanceAbsence({
        requestedRegion: 'us-east-1',
        discoveryRegionsSucceeded: ['us-east-1'],
        discoveryRegionsFailed: [],
        discoveryRunStatus: 'SUCCEEDED',
        securityRunStatus: 'SUCCEEDED',
        resourceLifecycleStatus: 'ACTIVE',
      }),
      true,
    );
    assert.equal(
      isAuthoritativeForGovernanceAbsence({
        requestedRegion: 'us-east-1',
        discoveryRegionsSucceeded: ['us-east-1'],
        discoveryRegionsFailed: [],
        discoveryRunStatus: 'SUCCEEDED',
        securityRunStatus: 'SUCCEEDED',
        resourceLifecycleStatus: 'NOT_SEEN',
      }),
      false,
    );
    assert.equal(
      isAuthoritativeForGovernanceAbsence({
        requestedRegion: 'us-east-1',
        discoveryRegionsSucceeded: ['us-east-1'],
        discoveryRegionsFailed: [],
        discoveryRunStatus: 'SUCCEEDED',
        securityRunStatus: 'SUCCEEDED',
        resourceLifecycleStatus: 'STALE',
      }),
      false,
    );
  });

  it('requires security SUCCEEDED and discovery proof for the region', () => {
    assert.equal(
      isAuthoritativeForGovernanceAbsence({
        requestedRegion: 'us-east-1',
        discoveryRegionsSucceeded: ['us-east-1'],
        discoveryRegionsFailed: [],
        discoveryRunStatus: 'SUCCEEDED',
        securityRunStatus: 'PARTIAL',
        resourceLifecycleStatus: 'ACTIVE',
      }),
      false,
    );
    assert.equal(
      isAuthoritativeForGovernanceAbsence({
        requestedRegion: 'us-west-2',
        discoveryRegionsSucceeded: ['us-east-1'],
        discoveryRegionsFailed: [],
        discoveryRunStatus: 'SUCCEEDED',
        securityRunStatus: 'SUCCEEDED',
        resourceLifecycleStatus: 'ACTIVE',
      }),
      false,
    );
    assert.equal(
      isAuthoritativeForGovernanceAbsence({
        requestedRegion: 'us-east-1',
        discoveryRegionsSucceeded: ['us-east-1'],
        discoveryRegionsFailed: ['us-east-1'],
        discoveryRunStatus: 'PARTIAL',
        securityRunStatus: 'SUCCEEDED',
        resourceLifecycleStatus: 'ACTIVE',
      }),
      false,
    );
  });

  it('gates run-level reconciliation on security SUCCEEDED and non-failed discovery proof', () => {
    assert.equal(isRunAuthoritativeForMissingReconciliation(authority()), true);
    assert.equal(
      isRunAuthoritativeForMissingReconciliation(authority({ securityRunStatus: 'PARTIAL' })),
      false,
    );
    assert.equal(
      isRunAuthoritativeForMissingReconciliation(authority({ discoveryRunStatus: 'FAILED' })),
      false,
    );
    assert.equal(
      isRunAuthoritativeForMissingReconciliation(authority({ discoveryRunStatus: 'UNKNOWN' })),
      false,
    );
    assert.equal(
      isRunAuthoritativeForMissingReconciliation(authority({ discoveryRunStatus: 'PARTIAL' })),
      true,
    );
  });

  it('returns only requested regions with successful discovery proof', () => {
    const regions = authoritativeRegionsForGovernanceAbsence(
      authority({
        requestedRegions: ['us-east-1', 'us-west-2'],
        discoveryRegionsSucceeded: ['us-east-1', 'us-west-2'],
        discoveryRegionsFailed: ['us-west-2'],
      }),
    );
    assert.deepEqual(regions, ['us-east-1']);
  });
});
