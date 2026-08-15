import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
  buildPersistentRecommendationScenario,
  buildRecordEvidenceObservationInput,
  replayPersistenceScenario,
} from '../fixtures/evidence';

describe('Sprint 1 evidence tenant isolation fixtures', () => {
  it('Tenant A history is invisible to Tenant B list queries', async () => {
    const repo = new MockEvidenceObservationRepository();
    const input = buildRecordEvidenceObservationInput();
    await replayPersistenceScenario(repo, buildPersistentRecommendationScenario());

    const tenantAList = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: input.findingKey,
    });
    const tenantBList = await repo.listObservationsForFinding({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: input.findingKey,
    });

    assert.equal(tenantAList.items.length, 3);
    assert.equal(tenantBList.items.length, 0);
  });

  it('Tenant B cannot read Tenant A observation by logical id', async () => {
    const repo = new MockEvidenceObservationRepository();
    const created = await repo.recordObservation(buildRecordEvidenceObservationInput());
    const crossTenant = await repo.getObservationByLogicalId({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: created.observation.findingKey,
      analysisRunId: created.observation.analysisRunId,
      observationTimestamp: created.observation.observationTimestamp,
    });
    assert.equal(crossTenant, null);
  });

  it('Tenant B append does not mutate Tenant A history', async () => {
    const repo = new MockEvidenceObservationRepository();
    const tenantAInput = buildRecordEvidenceObservationInput();
    await repo.recordObservation(tenantAInput);

    const tenantBInput = buildRecordEvidenceObservationInput({
      identity: { tenantId: TENANT_B, accountId: ACCOUNT_A },
      analysisRunId: 'run-tenant-b',
    });
    await repo.recordObservation(tenantBInput);

    const tenantAList = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: tenantAInput.findingKey,
    });
    const tenantBList = await repo.listObservationsForFinding({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: tenantBInput.findingKey,
    });

    assert.equal(tenantAList.items.length, 1);
    assert.equal(tenantBList.items.length, 1);
    assert.notEqual(tenantAList.items[0]!.observationId, tenantBList.items[0]!.observationId);
  });

  it('changing accountId cannot read another account partition', async () => {
    const repo = new MockEvidenceObservationRepository();
    const created = await repo.recordObservation(buildRecordEvidenceObservationInput());
    const crossAccount = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_B,
      findingKey: created.observation.findingKey,
    });
    assert.equal(crossAccount.items.length, 0);
  });

  it('changing resourceId uses a different finding key and cannot see prior history', async () => {
    const repo = new MockEvidenceObservationRepository();
    await repo.recordObservation(buildRecordEvidenceObservationInput());
    const otherResource = buildRecordEvidenceObservationInput({
      identity: { resourceId: 'i-cross-resource' },
      analysisRunId: 'run-other-resource',
    });
    const result = await repo.recordObservation(otherResource);
    assert.equal(result.assessment.state, 'NEW');

    const originalList = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: buildRecordEvidenceObservationInput().findingKey,
    });
    const otherList = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: otherResource.findingKey,
    });
    assert.equal(originalList.items.length, 1);
    assert.equal(otherList.items.length, 1);
  });
});
