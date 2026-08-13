import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import {
  PersistenceConfigurationError,
  assertEc2EvidencePersistenceRequired,
} from '../../persistence/persistence-config';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';

function withEnvSync(
  vars: Record<string, string | undefined>,
  run: () => void,
): void {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    snapshot[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const key of Object.keys(vars)) {
      const previous = snapshot[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => void | Promise<void>,
): Promise<void> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    snapshot[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const key of Object.keys(vars)) {
      const previous = snapshot[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

const PRODUCTION_TABLE_ENV = {
  ENVIRONMENT: 'production',
  PERSISTENCE_ENABLED: 'true',
  WORKFLOWS_TABLE_NAME: 'wf',
  OWNERSHIP_TABLE_NAME: 'own',
  REPORTS_TABLE_NAME: 'rep',
  LEARNING_TABLE_NAME: 'learn',
  VERIFICATIONS_TABLE_NAME: 'ver',
  TENANTS_TABLE_NAME: 'tenants',
  MEMBERSHIPS_TABLE_NAME: 'memberships',
  INVITATIONS_TABLE_NAME: 'invitations',
  EXECUTION_PLANS_TABLE_NAME: 'execution-plans',
  AWS_ACCOUNTS_TABLE_NAME: 'aws-accounts',
  CLOUD_RESOURCES_TABLE_NAME: 'cloud-resources',
} as const;

async function seedStoppedInstanceScenario(resources: MockEc2CloudResourceRepository): Promise<void> {
  await resources.upsertDiscoveredResource({
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region: 'us-east-1',
    resourceType: 'INSTANCE',
    resourceId: 'i-stopped',
    tags: [],
    status: 'ACTIVE',
    metadata: { state: 'stopped' },
    discoveredAt: '2026-08-10T10:00:00.000Z',
  });
  await resources.upsertDiscoveredResource({
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region: 'us-east-1',
    resourceType: 'VOLUME',
    resourceId: 'vol-1',
    tags: [],
    status: 'ACTIVE',
    metadata: {
      sizeGiB: 50,
      volumeType: 'gp3',
      attachments: [{ instanceId: 'i-stopped', state: 'attached' }],
    },
    discoveredAt: '2026-08-10T10:00:00.000Z',
  });
}

describe('Sprint 1 production evidence fail-closed', () => {
  it('allows production wiring when EvidencePersistenceService is present', async () => {
    await withEnv(PRODUCTION_TABLE_ENV, async () => {
      const resources = new MockEc2CloudResourceRepository();
      const costRepo = new MockEc2CostRepository();
      const persistence = new EvidencePersistenceService(new MockEvidenceObservationRepository());
      const orchestrator = new Ec2CostAnalysisOrchestrator(
        resources,
        costRepo,
        costRepo,
        persistence,
      );

      const result = await orchestrator.run({
        tenantId: 'tenant-a',
        accountId: '111122223333',
        regions: ['us-east-1'],
        observationDays: 14,
        runId: 'run-production-wired',
        requestedAt: '2026-08-10T11:00:00.000Z',
        startedAt: '2026-08-10T11:00:00.000Z',
        metricsClientFactory: () => ({ collectMetrics: async () => [] }),
      });

      assert.equal(result.status, 'SUCCEEDED');
      assert.equal(result.instancesFound, 0);
    });
  });

  it('fails closed in production when EvidencePersistenceService is absent', async () => {
    await withEnv(PRODUCTION_TABLE_ENV, async () => {
      const resources = new MockEc2CloudResourceRepository();
      await seedStoppedInstanceScenario(resources);
      const costRepo = new MockEc2CostRepository();
      const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);

      await assert.rejects(
        () =>
          orchestrator.run({
            tenantId: 'tenant-a',
            accountId: '111122223333',
            regions: ['us-east-1'],
            observationDays: 14,
            runId: 'run-production-missing-evidence',
            requestedAt: '2026-08-10T11:00:00.000Z',
            startedAt: '2026-08-10T11:00:00.000Z',
            metricsClientFactory: () => ({ collectMetrics: async () => [] }),
          }),
        PersistenceConfigurationError,
      );

      const recommendations = await costRepo.listRecommendations({
        tenantId: 'tenant-a',
        accountId: '111122223333',
      });
      assert.equal(recommendations.items.length, 0);
    });
  });

  it('fails closed in staging when EvidencePersistenceService is absent', () => {
    withEnvSync(
      {
        ...PRODUCTION_TABLE_ENV,
        ENVIRONMENT: 'staging',
      },
      () => {
        assert.throws(
          () => assertEc2EvidencePersistenceRequired(undefined),
          PersistenceConfigurationError,
        );
      },
    );
  });

  it('allows test construction without EvidencePersistenceService', async () => {
    await withEnv(
      {
        ENVIRONMENT: 'test',
        PERSISTENCE_ENABLED: 'false',
      },
      async () => {
        const resources = new MockEc2CloudResourceRepository();
        const costRepo = new MockEc2CostRepository();
        const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);

        const result = await orchestrator.run({
          tenantId: 'tenant-a',
          accountId: '111122223333',
          regions: ['us-east-1'],
          observationDays: 14,
          runId: 'run-test-isolated',
          requestedAt: '2026-08-10T11:00:00.000Z',
          startedAt: '2026-08-10T11:00:00.000Z',
          metricsClientFactory: () => ({ collectMetrics: async () => [] }),
        });

        assert.equal(result.status, 'SUCCEEDED');
        assert.doesNotThrow(() => assertEc2EvidencePersistenceRequired(undefined));
      },
    );
  });

  it('allows local development construction without EvidencePersistenceService', () => {
    withEnvSync(
      {
        ENVIRONMENT: 'development',
        PERSISTENCE_ENABLED: 'false',
      },
      () => {
        assert.doesNotThrow(() => assertEc2EvidencePersistenceRequired(undefined));
      },
    );
  });
});
