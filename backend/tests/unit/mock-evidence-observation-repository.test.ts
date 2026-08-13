import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRecommendationFingerprintInputFromEc2Cost } from '../../persistence-intelligence/recommendation-fingerprint';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import type { RecordEvidenceObservationInput } from '../../persistence-intelligence/types';

function baseInput(overrides: Partial<RecordEvidenceObservationInput> = {}): RecordEvidenceObservationInput {
  return {
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region: 'us-east-1',
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: 'i-abc',
    findingKey: 'tenant-a#111122223333#us-east-1#i-abc#UNDERUTILIZED#1.0.0',
    recommendationId: 'rec-1',
    recommendedAction: 'Rightsize to t3.medium',
    category: 'UNDERUTILIZED',
    ruleId: 'ec2-cost-underutilized',
    ruleVersion: '1.0.0',
    analysisRunId: 'run-1',
    recommendationVersion: 1,
    fingerprintInput: buildRecommendationFingerprintInputFromEc2Cost({
      service: 'ec2',
      resourceType: 'INSTANCE',
      resourceId: 'i-abc',
      region: 'us-east-1',
      category: 'UNDERUTILIZED',
      recommendedAction: 'Rightsize to t3.medium',
      ruleId: 'ec2-cost-underutilized',
      ruleVersion: '1.0.0',
    }),
    observationTimestamp: '2026-08-10T12:00:00.000Z',
    collectionTimestamp: '2026-08-10T12:05:00.000Z',
    provenance: 'ec2-cost-analysis',
    ...overrides,
  };
}

describe('MockEvidenceObservationRepository', () => {
  it('writes and reads tenant-scoped observations', async () => {
    const repo = new MockEvidenceObservationRepository();
    const created = await repo.recordObservation(baseInput());
    assert.equal(created.created, true);
    assert.equal(created.assessment.state, 'NEW');

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 1);
  });

  it('denies cross-tenant reads via tenant-scoped partition boundary', async () => {
    const repo = new MockEvidenceObservationRepository();
    await repo.recordObservation(baseInput());
    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-b',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 0);
  });

  it('deduplicates logical observations idempotently', async () => {
    const repo = new MockEvidenceObservationRepository();
    const first = await repo.recordObservation(baseInput());
    const second = await repo.recordObservation(baseInput());
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.observation.observationId, second.observation.observationId);

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 1);
  });

  it('preserves multiple legitimate observations with the same fingerprint', async () => {
    const repo = new MockEvidenceObservationRepository();
    await repo.recordObservation(baseInput({ analysisRunId: 'run-1' }));
    const second = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-2',
        observationTimestamp: '2026-08-11T12:00:00.000Z',
        collectionTimestamp: '2026-08-11T12:05:00.000Z',
        recommendationVersion: 2,
      }),
    );
    assert.equal(second.assessment.state, 'STABLE');
    assert.equal(second.assessment.persistenceHours, 24);

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 2);
  });

  it('preserves historical records without overwrite', async () => {
    const repo = new MockEvidenceObservationRepository();
    const first = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-1',
        fingerprintInput: buildRecommendationFingerprintInputFromEc2Cost({
          service: 'ec2',
          resourceType: 'INSTANCE',
          resourceId: 'i-abc',
          region: 'us-east-1',
          category: 'UNDERUTILIZED',
          recommendedAction: 'Rightsize to t3.medium',
          ruleId: 'ec2-cost-underutilized',
          ruleVersion: '1.0.0',
        }),
      }),
    );
    const second = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-2',
        observationTimestamp: '2026-08-11T12:00:00.000Z',
        collectionTimestamp: '2026-08-11T12:05:00.000Z',
        recommendationVersion: 2,
        recommendedAction: 'Stop instance',
        fingerprintInput: buildRecommendationFingerprintInputFromEc2Cost({
          service: 'ec2',
          resourceType: 'INSTANCE',
          resourceId: 'i-abc',
          region: 'us-east-1',
          category: 'UNDERUTILIZED',
          recommendedAction: 'Stop instance',
          ruleId: 'ec2-cost-underutilized',
          ruleVersion: '1.0.0',
        }),
      }),
    );
    assert.equal(first.assessment.state, 'NEW');
    assert.equal(second.assessment.state, 'CHANGED');

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 2);
    assert.equal(listed.items[0]!.recommendedAction, 'Rightsize to t3.medium');
    assert.equal(listed.items[1]!.recommendedAction, 'Stop instance');
  });

  it('handles out-of-order insertion without corrupting prior history', async () => {
    const repo = new MockEvidenceObservationRepository();
    await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-1',
        observationTimestamp: '2026-08-10T12:00:00.000Z',
      }),
    );
    await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-3',
        observationTimestamp: '2026-08-12T12:00:00.000Z',
        recommendationVersion: 3,
      }),
    );
    const late = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-2',
        observationTimestamp: '2026-08-11T12:00:00.000Z',
        recommendationVersion: 2,
      }),
    );
    assert.equal(late.assessment.state, 'STABLE');
    assert.equal(late.assessment.persistenceHours, 24);

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 3);
  });
});
