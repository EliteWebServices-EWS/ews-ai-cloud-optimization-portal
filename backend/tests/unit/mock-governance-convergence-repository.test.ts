import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { computeGovernanceEvidenceFingerprint } from '../../governance-convergence/governance-evidence-fingerprint';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import type { RecordGovernanceEvidenceObservationInput } from '../../governance-convergence/types';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACCOUNT = 'acct-1';
const REGION = 'us-east-1';
const RESOURCE = 'i-abc123';
const CHECK = 'unrestricted_ssh';

function findingKey(tenantId = TENANT_A): string {
  return buildGovernanceConvergenceFindingKey({
    tenantId,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: CHECK,
  });
}

function observationInput(
  overrides: Partial<RecordGovernanceEvidenceObservationInput> & {
    satisfied?: boolean | undefined;
    tenantId?: string;
  } = {},
): RecordGovernanceEvidenceObservationInput {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const satisfied = overrides.satisfied ?? true;
  const ruleVersion = '1';
  const observationTimestamp = overrides.observationTimestamp ?? '2026-08-01T00:00:00.000Z';
  const analysisRunStartedAt = overrides.analysisRunStartedAt ?? observationTimestamp;
  return {
    tenantId,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: CHECK,
    findingKey: overrides.findingKey ?? findingKey(tenantId),
    analysisRunId: 'run-1',
    analysisRunStartedAt,
    observationTimestamp,
    collectionTimestamp: '2026-08-01T00:00:00.000Z',
    evidence: {
      satisfied,
      check: CHECK,
      category: 'security',
      fingerprint: computeGovernanceEvidenceFingerprint({ check: CHECK, satisfied, ruleVersion }),
      ruleVersion,
    },
    ...overrides,
  };
}

describe('MockGovernanceConvergenceRepository — duplicate processing', () => {
  it('is idempotent for the exact same logical observation', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const input = observationInput({ analysisRunId: 'run-dup' });

    const first = await repo.recordObservation(input);
    const second = await repo.recordObservation(input);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.observation.observationId, second.observation.observationId);

    const all = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(all.items.length, 1);
  });

  it('treats the same analysisRunId with a different observationTimestamp as a new observation (not a duplicate)', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(observationInput({ analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:00:00.000Z' }));
    const second = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:05:00.000Z' }),
    );
    assert.equal(second.created, true);
  });
});

describe('MockGovernanceConvergenceRepository — out-of-order evidence', () => {
  it('appends a late-arriving observation without rewriting prior rows and classifies it against its chronological predecessor', async () => {
    const repo = new MockGovernanceConvergenceRepository();

    // A at 10:00 (violating), B at 10:10 (compliant) recorded first...
    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-a', observationTimestamp: '2026-08-01T10:00:00.000Z', satisfied: false }),
    );
    const bResult = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-b', observationTimestamp: '2026-08-01T10:10:00.000Z', satisfied: true }),
    );
    assert.equal(bResult.result?.state, 'IMPROVED');

    // ...then C arrives late at 10:05 (between A and B), also compliant.
    const cResult = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-c', observationTimestamp: '2026-08-01T10:05:00.000Z', satisfied: true }),
    );

    // C must be classified against A (its true chronological predecessor),
    // not against B (which was merely written first).
    assert.equal(cResult.result?.state, 'IMPROVED');
    assert.equal(cResult.result?.previousEvidenceId, (await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    })).items.find((o) => o.analysisRunId === 'run-a')?.observationId);

    const all = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(all.items.length, 3);
    assert.deepEqual(
      all.items.map((o) => o.analysisRunId),
      ['run-a', 'run-c', 'run-b'],
    );
  });
});

describe('MockGovernanceConvergenceRepository — cross-tenant isolation', () => {
  it('never returns another tenant\'s observations or results even for the structurally identical resource/check', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(observationInput({ tenantId: TENANT_A, satisfied: false }));
    await repo.recordObservation(observationInput({ tenantId: TENANT_B, satisfied: true }));

    const aObservations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(TENANT_A),
    });
    const bObservations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(TENANT_B),
    });

    assert.equal(aObservations.items.length, 1);
    assert.equal(aObservations.items[0]?.tenantId, TENANT_A);
    // Querying tenant A's context for tenant B's findingKey must not leak tenant B's data.
    assert.equal(bObservations.items.length, 0);
  });

  it('resolves ownership from the finding key without a database read', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const owner = await repo.resolveOwnerTenantId(findingKey(TENANT_B));
    assert.equal(owner, TENANT_B);
  });

  it('keeps convergence classification fully independent across tenants sharing an identical evidence sequence', async () => {
    const repo = new MockGovernanceConvergenceRepository();

    await repo.recordObservation(
      observationInput({ tenantId: TENANT_A, analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    await repo.recordObservation(
      observationInput({ tenantId: TENANT_B, analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );

    const aSecond = await repo.recordObservation(
      observationInput({ tenantId: TENANT_A, analysisRunId: 'run-2', observationTimestamp: '2026-08-01T00:10:00.000Z', satisfied: true }),
    );
    const bSecond = await repo.recordObservation(
      observationInput({ tenantId: TENANT_B, analysisRunId: 'run-2', observationTimestamp: '2026-08-01T00:10:00.000Z', satisfied: false }),
    );

    assert.equal(aSecond.result?.state, 'IMPROVED');
    assert.equal(bSecond.result?.state, 'PRESERVED');
  });
});

describe('MockGovernanceConvergenceRepository — security finding lifecycle interaction', () => {
  it('tracks a full OPEN → RESOLVED → reopened OPEN lifecycle with correct convergence states', async () => {
    const repo = new MockGovernanceConvergenceRepository();

    const opened = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    assert.equal(opened.result, undefined); // first sighting — nothing to converge from yet

    const resolved = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-2', observationTimestamp: '2026-08-02T00:00:00.000Z', satisfied: true }),
    );
    assert.equal(resolved.result?.state, 'IMPROVED');

    const stillCompliant = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-3', observationTimestamp: '2026-08-03T00:00:00.000Z', satisfied: true }),
    );
    assert.equal(stillCompliant.result?.state, 'PRESERVED');

    const reopened = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-4', observationTimestamp: '2026-08-04T00:00:00.000Z', satisfied: false }),
    );
    assert.equal(reopened.result?.state, 'REPLACED');

    const results = await repo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.deepEqual(results.items.map((r) => r.state), ['IMPROVED', 'PRESERVED', 'REPLACED']);
  });
});

describe('MockGovernanceConvergenceRepository — missing evidence', () => {
  it('is a no-op when no prior observation exists for the finding', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const result = await repo.recordMissingEvidence({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-1',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
    });
    assert.equal(result, null);
  });

  it('persists a MISSING result referencing the last known observation when prior evidence exists', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const recorded = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: true }),
    );

    const missing = await repo.recordMissingEvidence({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-2',
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });

    assert.equal(missing?.state, 'MISSING');
    assert.equal(missing?.previousEvidenceId, recorded.observation.observationId);
    assert.equal(missing?.currentEvidenceId, undefined);

    // MISSING must never be inferable as compliance — the underlying
    // evidence observation log is untouched (no new observation logged for
    // evidence that was never produced).
    const observations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(observations.items.length, 1);
  });

  it('a MISSING result is visible via getLatestResult', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(observationInput({ analysisRunId: 'run-1', satisfied: true }));
    await repo.recordMissingEvidence({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-2',
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });

    const latest = await repo.getLatestResult(TENANT_A, ACCOUNT, findingKey());
    assert.equal(latest?.state, 'MISSING');
  });
});

describe('MockGovernanceConvergenceRepository — pagination', () => {
  it('paginates observations for a finding', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    for (let i = 0; i < 5; i += 1) {
      await repo.recordObservation(
        observationInput({
          analysisRunId: `run-${i}`,
          observationTimestamp: `2026-08-0${i + 1}T00:00:00.000Z`,
        }),
      );
    }

    const firstPage = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      limit: 2,
    });
    assert.equal(firstPage.items.length, 2);
    assert.ok(firstPage.nextToken);

    const secondPage = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      limit: 2,
      nextToken: firstPage.nextToken,
    });
    assert.equal(secondPage.items.length, 2);

    const thirdPage = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      limit: 2,
      nextToken: secondPage.nextToken,
    });
    assert.equal(thirdPage.items.length, 1);
    assert.equal(thirdPage.nextToken, undefined);
  });
});
