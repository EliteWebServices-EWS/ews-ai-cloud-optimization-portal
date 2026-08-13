import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stableStringify } from '../../persistence-intelligence/canonical-json';
import { PersistenceDataQualityError } from '../../persistence-intelligence/errors';
import {
  buildLogicalObservationId,
  selectRelevantPreviousObservation,
  sortObservationsByObservationTimestamp,
} from '../../persistence-intelligence/observation-ordering';
import { computePersistenceHours } from '../../persistence-intelligence/persistence-hours';
import { assessPersistence } from '../../persistence-intelligence/persistence-state-machine';
import { PERSISTENCE_REASON } from '../../persistence-intelligence/reason-codes';
import {
  buildRecommendationFingerprintInputFromEc2Cost,
  computeRecommendationFingerprint,
} from '../../persistence-intelligence/recommendation-fingerprint';
import { parseObservationTimestamp } from '../../persistence-intelligence/timestamp-rules';
import type {
  EvidenceObservationRecord,
  RecordEvidenceObservationInput,
} from '../../persistence-intelligence/types';

function baseInput(overrides: Partial<RecordEvidenceObservationInput> = {}): RecordEvidenceObservationInput {
  return {
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region: 'us-east-1',
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: 'i-abc',
    findingKey: 'fk-1',
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
      observedValues: { avgCpu: 4.2 },
      thresholds: { maxCpu: 20 },
    }),
    observationTimestamp: '2026-08-10T12:00:00.000Z',
    collectionTimestamp: '2026-08-10T12:05:00.000Z',
    provenance: 'ec2-cost-analysis',
    ...overrides,
  };
}

function observationFromInput(
  input: RecordEvidenceObservationInput,
  assessmentState: EvidenceObservationRecord['assessment']['state'],
  observationTimestamp: string,
  logicalSuffix = 'log-1',
): EvidenceObservationRecord {
  const fingerprint = computeRecommendationFingerprint(input.fingerprintInput);
  const logicalObservationId = buildLogicalObservationId({
    tenantId: input.tenantId,
    accountId: input.accountId,
    findingKey: input.findingKey,
    analysisRunId: input.analysisRunId,
    observationTimestamp,
  });
  return {
    observationId: `obs-${logicalSuffix}`,
    logicalObservationId,
    tenantId: input.tenantId,
    accountId: input.accountId,
    region: input.region,
    service: input.service,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    findingKey: input.findingKey,
    recommendationId: input.recommendationId,
    recommendationFingerprint: fingerprint,
    recommendedAction: input.recommendedAction,
    category: input.category,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    analysisRunId: input.analysisRunId,
    provenance: input.provenance,
    observationTimestamp,
    collectionTimestamp: input.collectionTimestamp,
    persistedAt: input.collectionTimestamp,
    assessment: {
      state: assessmentState,
      recommendationFingerprint: fingerprint,
      persistenceHours: null,
      reasonCodes: [PERSISTENCE_REASON.FIRST_OBSERVATION],
      logicalObservationId,
    },
    version: 1,
  };
}

describe('persistence intelligence fingerprint', () => {
  it('is deterministic for the same input', () => {
    const input = baseInput().fingerprintInput;
    assert.equal(
      computeRecommendationFingerprint(input),
      computeRecommendationFingerprint(input),
    );
  });

  it('ignores irrelevant JSON property ordering', () => {
    const left = computeRecommendationFingerprint({
      ...baseInput().fingerprintInput,
      observedValues: { avgCpu: 4.2, maxMem: 50 },
      thresholds: { maxCpu: 20, minDays: 14 },
    });
    const right = computeRecommendationFingerprint({
      ...baseInput().fingerprintInput,
      observedValues: { maxMem: 50, avgCpu: 4.2 },
      thresholds: { minDays: 14, maxCpu: 20 },
    });
    assert.equal(left, right);
  });

  it('changes when recommended action changes', () => {
    const base = baseInput().fingerprintInput;
    const changed = computeRecommendationFingerprint({
      ...base,
      recommendedAction: 'Stop instance',
    });
    assert.notEqual(computeRecommendationFingerprint(base), changed);
  });

  it('changes when target instance type changes', () => {
    const base = baseInput().fingerprintInput;
    assert.notEqual(
      computeRecommendationFingerprint(base),
      computeRecommendationFingerprint({ ...base, candidateInstanceType: 't3.large' }),
    );
  });

  it('throws when required fingerprint input is missing', () => {
    assert.throws(
      () =>
        computeRecommendationFingerprint({
          ...baseInput().fingerprintInput,
          recommendedAction: '   ',
        }),
      PersistenceDataQualityError,
    );
  });

  it('changes when category changes', () => {
    const base = baseInput().fingerprintInput;
    assert.notEqual(
      computeRecommendationFingerprint(base),
      computeRecommendationFingerprint({ ...base, category: 'REVIEW_DOWNSIZE' }),
    );
  });

  it('changes when resourceId changes', () => {
    const base = baseInput().fingerprintInput;
    assert.notEqual(
      computeRecommendationFingerprint(base),
      computeRecommendationFingerprint({ ...base, resourceId: 'i-other' }),
    );
  });

  it('changes when relevant threshold values change', () => {
    const base = baseInput().fingerprintInput;
    assert.notEqual(
      computeRecommendationFingerprint(base),
      computeRecommendationFingerprint({
        ...base,
        thresholds: { maxCpu: 25 },
      }),
    );
  });

  it('stableStringify canonicalizes nested objects', () => {
    assert.equal(
      stableStringify({ b: 1, a: { d: 2, c: 3 } }),
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe('persistence intelligence state machine', () => {
  it('classifies first observation as NEW', () => {
    const assessment = assessPersistence({ request: baseInput(), priorObservations: [] });
    assert.equal(assessment.state, 'NEW');
    assert.equal(assessment.persistenceHours, null);
    assert.ok(assessment.reasonCodes.includes(PERSISTENCE_REASON.FIRST_OBSERVATION));
  });

  it('classifies identical second observation as STABLE with persistence hours', () => {
    const firstInput = baseInput({
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-10T12:00:00.000Z',
    });
    const prior = [
      observationFromInput(firstInput, 'NEW', '2026-08-10T12:00:00.000Z', 'first'),
    ];
    const second = assessPersistence({
      request: baseInput({
        analysisRunId: 'run-2',
        observationTimestamp: '2026-08-11T12:00:00.000Z',
        recommendationVersion: 2,
      }),
      priorObservations: prior,
    });
    assert.equal(second.state, 'STABLE');
    assert.equal(second.persistenceHours, 24);
  });

  it('classifies changed recommendation action as CHANGED', () => {
    const firstInput = baseInput({ observationTimestamp: '2026-08-10T12:00:00.000Z' });
    const prior = [observationFromInput(firstInput, 'NEW', '2026-08-10T12:00:00.000Z')];
    const changed = assessPersistence({
      request: baseInput({
        observationTimestamp: '2026-08-11T12:00:00.000Z',
        recommendationVersion: 2,
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
      priorObservations: prior,
    });
    assert.equal(changed.state, 'CHANGED');
    assert.equal(changed.persistenceHours, 24);
  });

  it('returns MISSING_PREVIOUS only when expected prior history is unavailable', () => {
    const assessment = assessPersistence({
      request: baseInput({ expectedPriorHistory: true }),
      priorObservations: [],
    });
    assert.equal(assessment.state, 'MISSING_PREVIOUS');
    assert.ok(assessment.reasonCodes.includes(PERSISTENCE_REASON.PRIOR_HISTORY_MISSING));
  });

  it('classifies recommendation upsert version > 1 without evidence history as NEW', () => {
    const assessment = assessPersistence({
      request: baseInput({ recommendationVersion: 5 }),
      priorObservations: [],
    });
    assert.equal(assessment.state, 'NEW');
    assert.ok(assessment.reasonCodes.includes(PERSISTENCE_REASON.FIRST_OBSERVATION));
  });

  it('treats duplicate logical observation as idempotent', () => {
    const input = baseInput();
    const prior = [observationFromInput(input, 'NEW', input.observationTimestamp)];
    const duplicate = assessPersistence({ request: input, priorObservations: prior });
    assert.equal(duplicate.logicalObservationId, prior[0]!.logicalObservationId);
    assert.equal(duplicate.state, prior[0]!.assessment.state);
  });

  it('preserves legitimate repeated observations at different timestamps', () => {
    const first = baseInput({ analysisRunId: 'run-1', observationTimestamp: '2026-08-10T12:00:00.000Z' });
    const secondInput = baseInput({
      analysisRunId: 'run-2',
      observationTimestamp: '2026-08-12T12:00:00.000Z',
      recommendationVersion: 2,
    });
    const prior = [observationFromInput(first, 'NEW', first.observationTimestamp, 'a')];
    const assessment = assessPersistence({ request: secondInput, priorObservations: prior });
    assert.notEqual(assessment.logicalObservationId, prior[0]!.logicalObservationId);
    assert.equal(assessment.state, 'STABLE');
    assert.equal(assessment.persistenceHours, 48);
  });

  it('handles out-of-order timestamps deterministically', () => {
    const aug10 = observationFromInput(
      baseInput({ analysisRunId: 'run-a' }),
      'NEW',
      '2026-08-10T10:00:00.000Z',
      'aug10',
    );
    const aug12 = observationFromInput(
      baseInput({ analysisRunId: 'run-b' }),
      'STABLE',
      '2026-08-12T10:00:00.000Z',
      'aug12',
    );
    const lateAug11 = assessPersistence({
      request: baseInput({
        analysisRunId: 'run-c',
        observationTimestamp: '2026-08-11T10:00:00.000Z',
      }),
      priorObservations: [aug10, aug12],
    });
    assert.equal(lateAug11.state, 'STABLE');
    assert.equal(lateAug11.persistenceHours, 24);
    assert.equal(lateAug11.comparedToObservationId, aug10.observationId);
  });

  it('does not treat same-timestamp earlier logical observation as temporal prior', () => {
    const sharedTimestamp = '2026-08-10T12:00:00.000Z';
    const first = observationFromInput(
      baseInput({ analysisRunId: 'run-a' }),
      'NEW',
      sharedTimestamp,
      'aaa',
    );
    const secondInput = baseInput({
      analysisRunId: 'run-b',
      observationTimestamp: sharedTimestamp,
    });
    const assessment = assessPersistence({
      request: secondInput,
      priorObservations: [first],
    });
    assert.equal(assessment.state, 'NEW');
    assert.notEqual(assessment.logicalObservationId, first.logicalObservationId);
    const sorted = sortObservationsByObservationTimestamp([first, observationFromInput(secondInput, 'NEW', sharedTimestamp, 'bbb')]);
    assert.ok(sorted[0]!.logicalObservationId.localeCompare(sorted[1]!.logicalObservationId) <= 0);
  });
});

describe('persistence intelligence timestamps', () => {
  it('throws on missing observation timestamp', () => {
    assert.throws(() => parseObservationTimestamp(''), PersistenceDataQualityError);
  });

  it('throws on invalid observation timestamp', () => {
    assert.throws(() => parseObservationTimestamp('not-a-date'), PersistenceDataQualityError);
  });

  it('computes zero persistence hours for same timestamp boundary', () => {
    const hours = computePersistenceHours({
      currentObservationTimestamp: '2026-08-10T12:00:00.000Z',
      previousObservationTimestamp: '2026-08-10T12:00:00.000Z',
    });
    assert.equal(hours, 0);
  });

  it('rejects negative persistence duration', () => {
    assert.throws(
      () =>
        computePersistenceHours({
          currentObservationTimestamp: '2026-08-09T12:00:00.000Z',
          previousObservationTimestamp: '2026-08-10T12:00:00.000Z',
        }),
      PersistenceDataQualityError,
    );
  });

  it('sorts observations by observationTimestamp then logicalObservationId', () => {
    const input = baseInput();
    const b = observationFromInput(input, 'NEW', '2026-08-11T12:00:00.000Z', 'b');
    const a = observationFromInput(input, 'NEW', '2026-08-10T12:00:00.000Z', 'a');
    const sorted = sortObservationsByObservationTimestamp([b, a]);
    assert.equal(sorted[0]!.observationId, a.observationId);
    assert.equal(
      selectRelevantPreviousObservation(sorted, '2026-08-12T12:00:00.000Z')?.observationId,
      b.observationId,
    );
  });
});
