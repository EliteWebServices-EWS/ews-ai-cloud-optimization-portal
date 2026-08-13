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

describe('Sprint 1 persistence regression', () => {
  it('selects the correct previous observation with more than 100 historical rows', async () => {
    const repo = new MockEvidenceObservationRepository();
    const findingKey = baseInput().findingKey;

    for (let index = 1; index <= 99; index += 1) {
      const timestamp = new Date(Date.parse('2026-08-01T00:00:00.000Z') + (index - 1) * 60 * 60 * 1000).toISOString();
      await repo.recordObservation(
        baseInput({
          analysisRunId: `run-${String(index).padStart(3, '0')}`,
          observationTimestamp: timestamp,
          collectionTimestamp: timestamp,
          recommendationVersion: index,
        }),
      );
    }

    const observation100 = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-100',
        observationTimestamp: '2026-08-10T00:00:00.000Z',
        collectionTimestamp: '2026-08-10T00:05:00.000Z',
        recommendationVersion: 100,
      }),
    );

    const observation101 = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-101',
        observationTimestamp: '2026-08-10T12:00:00.000Z',
        collectionTimestamp: '2026-08-10T12:05:00.000Z',
        recommendationVersion: 101,
      }),
    );
    void observation100;

    const current = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-current',
        observationTimestamp: '2026-08-11T00:00:00.000Z',
        collectionTimestamp: '2026-08-11T00:05:00.000Z',
        recommendationVersion: 102,
      }),
    );

    assert.equal(current.assessment.state, 'STABLE');
    assert.equal(current.assessment.comparedToObservationId, observation101.observation.observationId);
    assert.equal(current.assessment.persistenceHours, 12);

    const relevantPrevious = await repo.findRelevantPreviousObservation({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey,
      beforeObservationTimestamp: '2026-08-11T00:00:00.000Z',
    });
    assert.equal(relevantPrevious?.observationId, observation101.observation.observationId);
  });

  it('preserves Aug 10 / Aug 11 / Aug 12 legitimate repeated observations as NEW then STABLE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const aug10 = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-aug-10',
        observationTimestamp: '2026-08-10T12:00:00.000Z',
      }),
    );
    const aug11 = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-aug-11',
        observationTimestamp: '2026-08-11T12:00:00.000Z',
        recommendationVersion: 2,
      }),
    );
    const aug12 = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-aug-12',
        observationTimestamp: '2026-08-12T12:00:00.000Z',
        recommendationVersion: 3,
      }),
    );

    assert.equal(aug10.assessment.state, 'NEW');
    assert.equal(aug11.assessment.state, 'STABLE');
    assert.equal(aug12.assessment.state, 'STABLE');

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
      limit: 100,
    });
    assert.equal(listed.items.length, 3);
  });

  it('does not create a second row for duplicate logical delivery', async () => {
    const repo = new MockEvidenceObservationRepository();
    const first = await repo.recordObservation(baseInput());
    const duplicate = await repo.recordObservation(baseInput());

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(first.observation.observationId, duplicate.observation.observationId);
    assert.equal(first.assessment.state, duplicate.assessment.state);

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 1);
  });

  it('appends late observation C without overwriting A or B', async () => {
    const repo = new MockEvidenceObservationRepository();
    const a = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-a',
        observationTimestamp: '2026-08-10T10:00:00.000Z',
      }),
    );
    const b = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-b',
        observationTimestamp: '2026-08-12T10:00:00.000Z',
        recommendationVersion: 2,
      }),
    );
    const c = await repo.recordObservation(
      baseInput({
        analysisRunId: 'run-c',
        observationTimestamp: '2026-08-11T10:00:00.000Z',
        recommendationVersion: 3,
      }),
    );

    assert.equal(c.assessment.state, 'STABLE');
    assert.equal(c.assessment.comparedToObservationId, a.observation.observationId);
    assert.equal(c.assessment.persistenceHours, 24);
    assert.ok((c.assessment.persistenceHours ?? 0) >= 0);

    const listed = await repo.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: baseInput().findingKey,
    });
    assert.equal(listed.items.length, 3);
    assert.equal(listed.items.find((item) => item.observationId === a.observation.observationId)?.recommendedAction, a.observation.recommendedAction);
    assert.equal(listed.items.find((item) => item.observationId === b.observation.observationId)?.recommendedAction, b.observation.recommendedAction);
  });
});
