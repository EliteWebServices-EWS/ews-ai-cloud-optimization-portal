import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { GOVERNANCE_CONVERGENCE_REASON } from '../../governance-convergence/reason-codes';
import { GOVERNANCE_TRACKED_CHECKS } from '../../governance-convergence/governance-evidence-reuse';
import type { Ec2SecurityAnalysisResponse } from '../../engines/ec2-security/ec2-security.types';
import { DEFAULT_EC2_GOVERNANCE_POLICY } from '../../engines/ec2-security/ec2-security.analyzer';
import type { RecordGovernanceEvidenceObservationInput } from '../../governance-convergence/types';
import type { GovernanceRunAuthorityContext } from '../../governance-convergence/governance-convergence-authority';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import {
  GovernanceConvergenceService,
  type GovernanceActiveInventoryInstance,
  type PersistGovernanceConvergenceForSecurityRunInput,
} from '../../services/governance-convergence-service';

const TENANT = 'tenant-a';
const ACCOUNT = '111122223333';
const REGION = 'us-east-1';
const INSTANCE = 'i-live-missing';

function authority(overrides: Partial<GovernanceRunAuthorityContext> = {}): GovernanceRunAuthorityContext {
  return {
    requestedRegions: [REGION],
    securityRunStatus: 'SUCCEEDED',
    discoveryRunStatus: 'SUCCEEDED',
    discoveryRegionsSucceeded: [REGION],
    discoveryRegionsFailed: [],
    ...overrides,
  };
}

function sshFindingKey(): string {
  return buildGovernanceConvergenceFindingKey({
    tenantId: TENANT,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: INSTANCE,
    check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
  });
}

function compliantAnalysis(): Ec2SecurityAnalysisResponse {
  return {
    analyzedAt: '2026-08-02T00:00:00.000Z',
    policy: DEFAULT_EC2_GOVERNANCE_POLICY,
    summary: {
      instancesAnalyzed: 1,
      securityScore: 100,
      governanceScore: 100,
      riskLevel: 'low',
    },
    results: [
      {
        instanceId: INSTANCE,
        securityScore: 100,
        governanceScore: 100,
        riskLevel: 'low',
        securityFindings: [],
        governanceFindings: [],
        recommendations: [],
      },
    ],
  };
}

function persistInput(
  analysis: Ec2SecurityAnalysisResponse,
  overrides: Partial<PersistGovernanceConvergenceForSecurityRunInput> = {},
): PersistGovernanceConvergenceForSecurityRunInput {
  const instanceRegions = new Map<string, string>([[INSTANCE, REGION]]);
  const activeInventoryInstances: GovernanceActiveInventoryInstance[] = [
    { instanceId: INSTANCE, region: REGION, lifecycleStatus: 'ACTIVE' },
  ];
  return {
    tenantId: TENANT,
    accountId: ACCOUNT,
    analysisRunId: 'run-current',
    analysis,
    instanceRegions,
    observationTimestamp: analysis.analyzedAt,
    collectionTimestamp: analysis.analyzedAt,
    authority: authority(),
    activeInventoryInstances,
    ...overrides,
  };
}

async function seedDiscoveryRun(resources: MockEc2CloudResourceRepository, regions: string[]): Promise<void> {
  const run = await resources.createRun({
    runId: 'discovery-run-1',
    tenantId: TENANT,
    accountId: ACCOUNT,
    requestedRegions: regions,
    startedAt: '2026-01-01T00:00:00.000Z',
  });
  await resources.completeRun({
    tenantId: TENANT,
    accountId: ACCOUNT,
    runId: run.runId,
    expectedVersion: run.version,
    status: 'SUCCEEDED',
    completedAt: '2026-01-01T00:05:00.000Z',
    resourceCounts: { INSTANCE: 1 },
    regionsSucceeded: regions,
    regionsFailed: [],
    warnings: [],
  });
}

class AbsentObservationGovernanceService extends GovernanceConvergenceService {
  constructor(
    repository: MockGovernanceConvergenceRepository,
    resources: MockEc2CloudResourceRepository,
    private readonly suppressFindingKey: string,
  ) {
    super(repository, resources);
  }

  protected override shouldRecordCurrentObservation(findingKey: string): boolean {
    return findingKey !== this.suppressFindingKey;
  }
}

describe('governance live MISSING reconciliation', () => {
  it('records MISSING when prior checkpoint exists and current authoritative observation is genuinely absent', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const baseline = new GovernanceConvergenceService(repo, resources);
    const findingKey = sshFindingKey();

    await baseline.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );

    const service = new AbsentObservationGovernanceService(repo, resources, findingKey);
    const result = await service.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), { analysisRunId: 'run-missing-live' }),
    );
    assert.equal(result.missingRecorded, 1);

    const missing = await repo.getLatestResult(TENANT, ACCOUNT, findingKey);
    assert.equal(missing?.state, 'MISSING');
    assert.equal(missing?.analysisRunId, 'run-missing-live');
    assert.ok(missing?.reasonCodes.includes(GOVERNANCE_CONVERGENCE_REASON.CURRENT_EVIDENCE_ABSENT));
    assert.ok(missing?.previousEvidenceId);
    assert.equal(missing?.currentEvidenceId, undefined);
  });

  it('does not emit MISSING for NOT_SEEN, STALE, or terminated-equivalent lifecycle', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const service = new GovernanceConvergenceService(repo, resources);
    const findingKey = sshFindingKey();

    await service.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );

    for (const lifecycleStatus of ['NOT_SEEN', 'STALE'] as const) {
      const absent = new AbsentObservationGovernanceService(repo, resources, findingKey);
      const outcome = await absent.persistForSecurityAnalysisRun(
        persistInput(compliantAnalysis(), {
          analysisRunId: `run-${lifecycleStatus}`,
          activeInventoryInstances: [{ instanceId: INSTANCE, region: REGION, lifecycleStatus }],
        }),
      );
      assert.equal(outcome.missingRecorded, 0, lifecycleStatus);
    }
  });

  it('does not emit MISSING outside authoritative region scope', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const baseline = new GovernanceConvergenceService(repo, resources);
    const westKey = buildGovernanceConvergenceFindingKey({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-west-2',
      resourceId: INSTANCE,
      check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
    });

    await baseline.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior-west',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
        instanceRegions: new Map([[INSTANCE, 'us-west-2']]),
        activeInventoryInstances: [{ instanceId: INSTANCE, region: 'us-west-2', lifecycleStatus: 'ACTIVE' }],
      }),
    );

    const absent = new AbsentObservationGovernanceService(repo, resources, westKey);
    const outcome = await absent.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-east-only',
        authority: authority({
          requestedRegions: [REGION],
          discoveryRegionsSucceeded: ['us-west-2', REGION],
        }),
      }),
    );
    assert.equal(outcome.missingRecorded, 0);
  });

  it('does not reconcile MISSING for partial or failed security runs', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const baseline = new GovernanceConvergenceService(repo, resources);
    const findingKey = sshFindingKey();
    await baseline.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );

    for (const securityRunStatus of ['PARTIAL', 'FAILED'] as const) {
      const absent = new AbsentObservationGovernanceService(repo, resources, findingKey);
      const outcome = await absent.persistForSecurityAnalysisRun(
        persistInput(compliantAnalysis(), {
          analysisRunId: `run-${securityRunStatus}`,
          authority: authority({ securityRunStatus }),
        }),
      );
      assert.equal(outcome.missingRecorded, 0, securityRunStatus);
    }
  });

  it('does not reconcile MISSING when discovery proof is incomplete for the region', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const baseline = new GovernanceConvergenceService(repo, resources);
    const findingKey = sshFindingKey();
    await baseline.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );

    const absent = new AbsentObservationGovernanceService(repo, resources, findingKey);
    const outcome = await absent.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-discovery-failed-region',
        authority: authority({
          discoveryRunStatus: 'PARTIAL',
          discoveryRegionsSucceeded: [],
          discoveryRegionsFailed: [REGION],
        }),
      }),
    );
    assert.equal(outcome.missingRecorded, 0);
  });

  it('does not emit MISSING for satisfied undefined or persistence failures', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const baseline = new GovernanceConvergenceService(repo, resources);
    await baseline.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );

    const insufficientAnalysis: Ec2SecurityAnalysisResponse = {
      ...compliantAnalysis(),
      results: [
        {
          ...compliantAnalysis().results[0]!,
          securityFindings: [
            {
              check: 'insufficient_security_group_evidence',
              severity: 'medium',
              message: 'missing sg evidence',
              remediation: 'collect sg evidence',
            },
          ],
        },
      ],
    };
    const insufficient = await baseline.persistForSecurityAnalysisRun(
      persistInput(insufficientAnalysis, { analysisRunId: 'run-insufficient' }),
    );
    assert.equal(insufficient.missingRecorded, 0);
    const sshResults = await repo.listResultsForFinding({
      tenantId: TENANT,
      accountId: ACCOUNT,
      findingKey: sshFindingKey(),
    });
    assert.equal(sshResults.items.some((item) => item.state === 'MISSING'), false);

    class SshPersistFailureRepository extends MockGovernanceConvergenceRepository {
      override async recordObservation(input: RecordGovernanceEvidenceObservationInput) {
        if (input.check === GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE) {
          throw new Error('simulated persistence failure');
        }
        return super.recordObservation(input);
      }
    }
    const failingService = new GovernanceConvergenceService(new SshPersistFailureRepository(), resources);
    const failed = await failingService.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), { analysisRunId: 'run-persist-failure' }),
    );
    assert.ok(failed.warnings.some((warning) => warning.includes('Governance convergence failed')));
    assert.equal(failed.missingRecorded, 0);
  });

  it('does not mutate historical observation or result rows when updating checkpoints', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    const service = new GovernanceConvergenceService(repo, resources);
    const findingKey = sshFindingKey();

    await service.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-1',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );
    const observationsBefore = await repo.listObservationsForFinding({
      tenantId: TENANT,
      accountId: ACCOUNT,
      findingKey,
    });
    const resultsBefore = await repo.listResultsForFinding({
      tenantId: TENANT,
      accountId: ACCOUNT,
      findingKey,
    });

    await repo.upsertLatestObservedControl({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: REGION,
      resourceId: INSTANCE,
      check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
      findingKey,
      latestObservationId: 'manual-obs',
      latestLogicalObservationId: 'manual-logical',
      latestObservationTimestamp: '2026-09-01T00:00:00.000Z',
      latestAnalysisRunId: 'run-manual',
      latestRuleVersion: '1',
      resourceLifecycleStatus: 'ACTIVE',
    });

    const observationsAfter = await repo.listObservationsForFinding({
      tenantId: TENANT,
      accountId: ACCOUNT,
      findingKey,
    });
    const resultsAfter = await repo.listResultsForFinding({
      tenantId: TENANT,
      accountId: ACCOUNT,
      findingKey,
    });
    assert.deepEqual(observationsAfter.items, observationsBefore.items);
    assert.deepEqual(resultsAfter.items, resultsBefore.items);
  });

  it('uses discovery proof from resources when orchestrator supplies authority', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const resources = new MockEc2CloudResourceRepository();
    await seedDiscoveryRun(resources, [REGION]);
    const service = new GovernanceConvergenceService(repo, resources);
    const findingKey = sshFindingKey();

    await service.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-prior',
        observationTimestamp: '2026-08-01T00:00:00.000Z',
        collectionTimestamp: '2026-08-01T00:00:00.000Z',
      }),
    );

    const absent = new AbsentObservationGovernanceService(repo, resources, findingKey);
    const latestDiscovery = await resources.getLatestSuccessfulRun(TENANT, ACCOUNT);
    const outcome = await absent.persistForSecurityAnalysisRun(
      persistInput(compliantAnalysis(), {
        analysisRunId: 'run-with-discovery-proof',
        authority: {
          requestedRegions: [REGION],
          securityRunStatus: 'SUCCEEDED',
          discoveryRunStatus: latestDiscovery?.status ?? 'UNKNOWN',
          discoveryRegionsSucceeded: latestDiscovery?.regionsSucceeded ?? [],
          discoveryRegionsFailed: latestDiscovery?.regionsFailed ?? [],
        },
      }),
    );
    assert.equal(outcome.missingRecorded, 1);
  });
});
