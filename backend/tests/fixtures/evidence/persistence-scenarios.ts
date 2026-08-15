import type { PersistenceState, RecordEvidenceObservationInput } from '../../../persistence-intelligence/types';
import type { EvidenceObservationRepository } from '../../../repositories/contracts/evidence-observation-repository';
import {
  buildRecommendationFingerprintInputFromEc2Cost,
} from '../../../persistence-intelligence/recommendation-fingerprint';
import {
  FIXED_COLLECTION_TS_1,
  FIXED_COLLECTION_TS_2,
  FIXED_COLLECTION_TS_3,
  FIXED_OBSERVATION_TS_1,
  FIXED_OBSERVATION_TS_2,
  FIXED_OBSERVATION_TS_3,
  RESOURCE_ID_A,
  REGION,
} from './identities';
import { buildRecordEvidenceObservationInput } from './observation-builders';

export interface NamedPersistenceScenario {
  name: string;
  inputs: RecordEvidenceObservationInput[];
  expectedStates: PersistenceState[];
}

export interface RejectionPersistenceScenario {
  name: string;
  inputs: RecordEvidenceObservationInput[];
  expectedError: 'PersistenceDataQualityError';
}

export function buildNewRecommendationScenario(): NamedPersistenceScenario {
  return {
    name: 'NEW_RECOMMENDATION',
    inputs: [buildRecordEvidenceObservationInput({ analysisRunId: 'run-new-1' })],
    expectedStates: ['NEW'],
  };
}

/** SCENARIO A — three observations with unchanged fingerprint → NEW, STABLE, STABLE */
export function buildPersistentRecommendationScenario(): NamedPersistenceScenario {
  return {
    name: 'PERSISTENT_RECOMMENDATION',
    inputs: [
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-persist-1',
        observationTimestamp: FIXED_OBSERVATION_TS_1,
        collectionTimestamp: FIXED_COLLECTION_TS_1,
      }),
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-persist-2',
        observationTimestamp: FIXED_OBSERVATION_TS_2,
        collectionTimestamp: FIXED_COLLECTION_TS_2,
        recommendationVersion: 2,
      }),
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-persist-3',
        observationTimestamp: FIXED_OBSERVATION_TS_3,
        collectionTimestamp: FIXED_COLLECTION_TS_3,
        recommendationVersion: 3,
      }),
    ],
    expectedStates: ['NEW', 'STABLE', 'STABLE'],
  };
}

/** SCENARIO B — fingerprint change on second observation → NEW, CHANGED */
export function buildChangedRecommendationScenario(): NamedPersistenceScenario {
  return {
    name: 'CHANGED_RECOMMENDATION',
    inputs: [
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-changed-1',
        observationTimestamp: FIXED_OBSERVATION_TS_1,
      }),
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-changed-2',
        observationTimestamp: FIXED_OBSERVATION_TS_2,
        collectionTimestamp: FIXED_COLLECTION_TS_2,
        recommendationVersion: 2,
        recommendedAction: 'Stop instance',
        fingerprintInput: buildRecommendationFingerprintInputFromEc2Cost({
          service: 'ec2',
          resourceType: 'INSTANCE',
          resourceId: RESOURCE_ID_A,
          region: REGION,
          category: 'UNDERUTILIZED',
          recommendedAction: 'Stop instance',
          ruleId: 'ec2-cost-underutilized',
          ruleVersion: '1.0.0',
        }),
      }),
    ],
    expectedStates: ['NEW', 'CHANGED'],
  };
}

/** SCENARIO C — expected prior history but none exists → MISSING_PREVIOUS */
export function buildMissingPreviousScenario(): NamedPersistenceScenario {
  return {
    name: 'MISSING_PREVIOUS',
    inputs: [
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-missing-prev',
        expectedPriorHistory: true,
      }),
    ],
    expectedStates: ['MISSING_PREVIOUS'],
  };
}

export function buildDuplicateObservationScenario(): NamedPersistenceScenario {
  const input = buildRecordEvidenceObservationInput({ analysisRunId: 'run-dup' });
  return {
    name: 'DUPLICATE_LOGICAL_OBSERVATION',
    inputs: [input, structuredClone(input)],
    expectedStates: ['NEW', 'NEW'],
  };
}

export function buildSameJobDifferentTimestampScenario(): NamedPersistenceScenario {
  const sharedRunId = 'run-same-job';
  return {
    name: 'SAME_JOB_DIFFERENT_TIMESTAMP',
    inputs: [
      buildRecordEvidenceObservationInput({
        analysisRunId: sharedRunId,
        observationTimestamp: FIXED_OBSERVATION_TS_1,
        jobId: 'job-001',
      }),
      buildRecordEvidenceObservationInput({
        analysisRunId: sharedRunId,
        observationTimestamp: FIXED_OBSERVATION_TS_2,
        collectionTimestamp: FIXED_COLLECTION_TS_2,
        recommendationVersion: 2,
        jobId: 'job-001',
      }),
    ],
    expectedStates: ['NEW', 'STABLE'],
  };
}

/** Out-of-order timeline: A (Aug 10), C (Aug 12), late B (Aug 11). */
export function buildOutOfOrderObservationScenario(): NamedPersistenceScenario {
  return {
    name: 'OUT_OF_ORDER_OBSERVATION',
    inputs: [
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-order-a',
        observationTimestamp: '2026-08-10T10:00:00.000Z',
        collectionTimestamp: '2026-08-10T10:05:00.000Z',
      }),
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-order-c',
        observationTimestamp: '2026-08-12T10:00:00.000Z',
        collectionTimestamp: '2026-08-12T10:05:00.000Z',
        recommendationVersion: 3,
      }),
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-order-b',
        observationTimestamp: '2026-08-11T10:00:00.000Z',
        collectionTimestamp: '2026-08-11T10:05:00.000Z',
        recommendationVersion: 2,
      }),
    ],
    expectedStates: ['NEW', 'STABLE', 'STABLE'],
  };
}

export function buildMalformedObservationScenario(): RejectionPersistenceScenario {
  return {
    name: 'MALFORMED_OBSERVATION',
    inputs: [
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-malformed',
        observationTimestamp: 'not-a-date',
      }),
    ],
    expectedError: 'PersistenceDataQualityError',
  };
}

export function buildManyHistoricalObservations(count: number): RecordEvidenceObservationInput[] {
  const inputs: RecordEvidenceObservationInput[] = [];
  for (let index = 1; index <= count; index += 1) {
    const timestamp = new Date(
      Date.parse('2026-08-01T00:00:00.000Z') + (index - 1) * 60 * 60 * 1000,
    ).toISOString();
    inputs.push(
      buildRecordEvidenceObservationInput({
        analysisRunId: `run-hist-${String(index).padStart(3, '0')}`,
        observationTimestamp: timestamp,
        collectionTimestamp: timestamp,
        recommendationVersion: index,
      }),
    );
  }
  return inputs;
}

export async function replayPersistenceScenario(
  repo: EvidenceObservationRepository,
  scenario: NamedPersistenceScenario,
): Promise<Array<{ created: boolean; state: PersistenceState }>> {
  const results: Array<{ created: boolean; state: PersistenceState }> = [];
  for (const input of scenario.inputs) {
    const result = await repo.recordObservation(input);
    results.push({ created: result.created, state: result.assessment.state });
  }
  return results;
}

export const ALL_NAMED_PERSISTENCE_SCENARIOS: NamedPersistenceScenario[] = [
  buildNewRecommendationScenario(),
  buildPersistentRecommendationScenario(),
  buildChangedRecommendationScenario(),
  buildMissingPreviousScenario(),
  buildDuplicateObservationScenario(),
  buildSameJobDifferentTimestampScenario(),
  buildOutOfOrderObservationScenario(),
];
