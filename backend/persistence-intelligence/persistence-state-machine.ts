import { PERSISTENCE_REASON } from './reason-codes';
import { computePersistenceHours } from './persistence-hours';
import {
  buildLogicalObservationId,
  findObservationByLogicalId,
  selectRelevantPreviousObservation,
} from './observation-ordering';
import { computeRecommendationFingerprint } from './recommendation-fingerprint';
import { parseObservationTimestamp } from './timestamp-rules';
import type {
  EvidenceObservationRecord,
  PersistenceAssessment,
  PersistenceState,
  RecordEvidenceObservationInput,
} from './types';

function buildAssessment(
  base: Omit<PersistenceAssessment, 'recommendationFingerprint' | 'logicalObservationId'>,
  fingerprint: string,
  logicalObservationId: string,
): PersistenceAssessment {
  return {
    ...base,
    recommendationFingerprint: fingerprint,
    logicalObservationId,
  };
}

export function assessPersistence(input: {
  request: RecordEvidenceObservationInput;
  priorObservations: EvidenceObservationRecord[];
}): PersistenceAssessment {
  const fingerprint = computeRecommendationFingerprint(input.request.fingerprintInput);
  const observationTimestamp = parseObservationTimestamp(input.request.observationTimestamp).iso;
  const logicalObservationId = buildLogicalObservationId({
    tenantId: input.request.tenantId,
    accountId: input.request.accountId,
    findingKey: input.request.findingKey,
    analysisRunId: input.request.analysisRunId,
    observationTimestamp,
  });

  const duplicate = findObservationByLogicalId(input.priorObservations, logicalObservationId);
  if (duplicate) {
    return duplicate.assessment;
  }

  const prior = selectRelevantPreviousObservation(
    input.priorObservations,
    observationTimestamp,
    logicalObservationId,
  );

  if (!prior) {
    if (input.request.expectedPriorHistory) {
      return buildAssessment(
        {
          state: 'MISSING_PREVIOUS',
          persistenceHours: null,
          reasonCodes: [PERSISTENCE_REASON.PRIOR_HISTORY_MISSING],
        },
        fingerprint,
        logicalObservationId,
      );
    }
    return buildAssessment(
      {
        state: 'NEW',
        persistenceHours: null,
        reasonCodes: [PERSISTENCE_REASON.FIRST_OBSERVATION],
      },
      fingerprint,
      logicalObservationId,
    );
  }

  if (prior.recommendationFingerprint === fingerprint) {
    return buildAssessment(
      {
        state: 'STABLE',
        persistenceHours: computePersistenceHours({
          currentObservationTimestamp: observationTimestamp,
          previousObservationTimestamp: prior.observationTimestamp,
        }),
        reasonCodes: [PERSISTENCE_REASON.FINGERPRINT_UNCHANGED],
        comparedToObservationId: prior.observationId,
      },
      fingerprint,
      logicalObservationId,
    );
  }

  return buildAssessment(
    {
      state: 'CHANGED',
      persistenceHours: computePersistenceHours({
        currentObservationTimestamp: observationTimestamp,
        previousObservationTimestamp: prior.observationTimestamp,
      }),
      reasonCodes: [PERSISTENCE_REASON.FINGERPRINT_CHANGED],
      comparedToObservationId: prior.observationId,
    },
    fingerprint,
    logicalObservationId,
  );
}

export function classifyPersistenceStateForTest(
  currentFingerprint: string,
  previousFingerprint: string | null,
): PersistenceState {
  if (!previousFingerprint) {
    return 'NEW';
  }
  return currentFingerprint === previousFingerprint ? 'STABLE' : 'CHANGED';
}
