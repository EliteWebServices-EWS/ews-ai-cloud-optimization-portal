import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { GOVERNANCE_TRACKED_CHECKS } from '../../governance-convergence/governance-evidence-reuse';
import { DynamoDbGovernanceConvergenceRepository } from '../../repositories/dynamodb/dynamodb-governance-convergence-repository';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '444455556666';
const REGION_EAST = 'us-east-1';
const REGION_WEST = 'us-west-2';

function checkpointInput(params: {
  tenantId?: string;
  accountId?: string;
  region?: string;
  resourceId?: string;
  check?: string;
  timestamp?: string;
  observationId?: string;
}) {
  const tenantId = params.tenantId ?? TENANT_A;
  const accountId = params.accountId ?? ACCOUNT_A;
  const region = params.region ?? REGION_EAST;
  const resourceId = params.resourceId ?? 'i-abc';
  const check = params.check ?? GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE;
  const findingKey = buildGovernanceConvergenceFindingKey({
    tenantId,
    accountId,
    region,
    resourceId,
    check,
  });
  return {
    tenantId,
    accountId,
    region,
    resourceId,
    check,
    findingKey,
    latestObservationId: params.observationId ?? `obs-${params.timestamp ?? '2026-01-01T00:00:00.000Z'}`,
    latestLogicalObservationId: `log-${params.timestamp ?? '2026-01-01T00:00:00.000Z'}`,
    latestObservationTimestamp: params.timestamp ?? '2026-01-01T00:00:00.000Z',
    latestAnalysisRunId: 'run-1',
    latestRuleVersion: '1',
    resourceLifecycleStatus: 'ACTIVE' as const,
  };
}

async function seedManyCheckpoints(
  repo: MockGovernanceConvergenceRepository,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await repo.upsertLatestObservedControl(
      checkpointInput({
        resourceId: `i-${String(index).padStart(4, '0')}`,
        timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      }),
    );
  }
}

describe('governance latest checkpoint repository parity', () => {
  it('mock paginates latest checkpoints without duplicates or skips', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await seedManyCheckpoints(repo, 101);

    const seen = new Set<string>();
    let nextToken: string | undefined;
    do {
      const page = await repo.listLatestObservedControls({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        regions: [REGION_EAST],
        limit: 25,
        nextToken,
      });
      for (const item of page.items) {
        const key = `${item.region}#${item.resourceId}#${item.check}`;
        assert.equal(seen.has(key), false);
        seen.add(key);
      }
      nextToken = page.nextToken;
    } while (nextToken);

    assert.equal(seen.size, 101);
  });

  it('mock isolates tenant and account checkpoint reads', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.upsertLatestObservedControl(checkpointInput({ tenantId: TENANT_A, accountId: ACCOUNT_A }));
    await repo.upsertLatestObservedControl(
      checkpointInput({ tenantId: TENANT_B, accountId: ACCOUNT_A, resourceId: 'i-other-tenant' }),
    );
    await repo.upsertLatestObservedControl(
      checkpointInput({ tenantId: TENANT_A, accountId: ACCOUNT_B, resourceId: 'i-other-account' }),
    );

    const tenantPage = await repo.listLatestObservedControls({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: [REGION_EAST],
    });
    assert.equal(tenantPage.items.length, 1);

    const crossTenant = await repo.listLatestObservedControls({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: [REGION_EAST],
    });
    assert.equal(crossTenant.items.some((item) => item.tenantId === TENANT_B), false);
  });

  it('mock filters latest checkpoints by region scope', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.upsertLatestObservedControl(checkpointInput({ region: REGION_EAST, resourceId: 'i-east' }));
    await repo.upsertLatestObservedControl(checkpointInput({ region: REGION_WEST, resourceId: 'i-west' }));

    const eastOnly = await repo.listLatestObservedControls({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: [REGION_EAST],
    });
    assert.equal(eastOnly.items.length, 1);
    assert.equal(eastOnly.items[0]?.region, REGION_EAST);
  });

  it('mock rejects out-of-order checkpoint updates', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const input = checkpointInput({ timestamp: '2026-02-01T00:00:00.000Z', observationId: 'obs-new' });
    await repo.upsertLatestObservedControl(input);
    const stale = await repo.upsertLatestObservedControl(
      checkpointInput({ timestamp: '2026-01-01T00:00:00.000Z', observationId: 'obs-old' }),
    );
    assert.equal(stale.latestObservationId, 'obs-new');
  });

  it('DynamoDB rejects out-of-order checkpoint updates', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    await repo.upsertLatestObservedControl(
      checkpointInput({ timestamp: '2026-02-01T00:00:00.000Z', observationId: 'obs-new' }),
    );
    const stale = await repo.upsertLatestObservedControl(
      checkpointInput({ timestamp: '2026-01-01T00:00:00.000Z', observationId: 'obs-old' }),
    );
    assert.equal(stale.latestObservationId, 'obs-new');
  });

  it('DynamoDB paginates latest checkpoints across pages', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    for (let index = 0; index < 101; index += 1) {
      await repo.upsertLatestObservedControl(
        checkpointInput({
          resourceId: `i-${String(index).padStart(4, '0')}`,
          timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        }),
      );
    }

    const seen = new Set<string>();
    let nextToken: string | undefined;
    do {
      const page = await repo.listLatestObservedControls({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        regions: [REGION_EAST],
        limit: 20,
        nextToken,
      });
      for (const item of page.items) {
        seen.add(`${item.region}#${item.resourceId}#${item.check}`);
      }
      nextToken = page.nextToken;
    } while (nextToken);
    assert.equal(seen.size, 101);
  });
});
