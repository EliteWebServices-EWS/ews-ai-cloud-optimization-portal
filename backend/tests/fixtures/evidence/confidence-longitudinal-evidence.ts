import { EVIDENCE_MATURITY_MODEL_VERSION } from '../../../evidence-maturity/model-version';
import type {
  ConfidenceLongitudinalEvidence,
  ConfidenceMaturityEvidence,
  ConfidencePersistenceEvidence,
} from '../../../shared/types';

const DEFAULT_RULE = {
  ruleId: 'ec2-cost-rightsizing',
  ruleVersion: '1.0.0',
};

export function buildStablePersistenceEvidence(
  overrides: Partial<ConfidencePersistenceEvidence> = {},
): ConfidencePersistenceEvidence {
  return {
    state: 'STABLE',
    persistenceHours: 48,
    reasonCodes: ['PERSISTENCE_FINGERPRINT_UNCHANGED'],
    logicalObservationId: 'logical-obs-stable-1',
    sourceObservationId: 'obs-stable-1',
    ...DEFAULT_RULE,
    ...overrides,
  };
}

export function buildNewPersistenceEvidence(
  overrides: Partial<ConfidencePersistenceEvidence> = {},
): ConfidencePersistenceEvidence {
  return buildStablePersistenceEvidence({
    state: 'NEW',
    persistenceHours: null,
    reasonCodes: ['PERSISTENCE_FIRST_OBSERVATION'],
    logicalObservationId: 'logical-obs-new-1',
    sourceObservationId: 'obs-new-1',
    ...overrides,
  });
}

export function buildChangedPersistenceEvidence(
  overrides: Partial<ConfidencePersistenceEvidence> = {},
): ConfidencePersistenceEvidence {
  return buildStablePersistenceEvidence({
    state: 'CHANGED',
    persistenceHours: 12,
    reasonCodes: ['PERSISTENCE_FINGERPRINT_CHANGED'],
    logicalObservationId: 'logical-obs-changed-1',
    sourceObservationId: 'obs-changed-1',
    ...overrides,
  });
}

export function buildMissingPreviousPersistenceEvidence(
  overrides: Partial<ConfidencePersistenceEvidence> = {},
): ConfidencePersistenceEvidence {
  return buildStablePersistenceEvidence({
    state: 'MISSING_PREVIOUS',
    persistenceHours: null,
    reasonCodes: ['PERSISTENCE_PRIOR_HISTORY_MISSING'],
    logicalObservationId: 'logical-obs-missing-prev-1',
    sourceObservationId: 'obs-missing-prev-1',
    ...overrides,
  });
}

export function buildMatureMaturityEvidence(
  overrides: Partial<ConfidenceMaturityEvidence> = {},
): ConfidenceMaturityEvidence {
  return {
    maturity: 'MATURE',
    modelVersion: EVIDENCE_MATURITY_MODEL_VERSION,
    reasonCodes: ['MATURITY_STABLE_HISTORY_SUPPORTS_MATURE', 'MATURITY_TELEMETRY_COMPLETE'],
    sourcePersistenceState: 'STABLE',
    stableEpochObservationCount: 3,
    stableEpochHours: 30,
    persistenceHours: 48,
    evidenceCompleteness: 'COMPLETE',
    telemetryApplicability: 'REQUIRED',
    sourceObservationId: 'obs-stable-1',
    sourceLogicalObservationId: 'logical-obs-stable-1',
    ...DEFAULT_RULE,
    ...overrides,
  };
}

export function buildPartialMaturityEvidence(
  overrides: Partial<ConfidenceMaturityEvidence> = {},
): ConfidenceMaturityEvidence {
  return buildMatureMaturityEvidence({
    maturity: 'PARTIAL',
    reasonCodes: ['MATURITY_STABLE_HISTORY_SUPPORTS_PARTIAL', 'MATURITY_TELEMETRY_PARTIAL'],
    stableEpochObservationCount: 2,
    stableEpochHours: 6,
    evidenceCompleteness: 'PARTIAL',
    ...overrides,
  });
}

export function buildImmatureMaturityEvidence(
  overrides: Partial<ConfidenceMaturityEvidence> = {},
): ConfidenceMaturityEvidence {
  return buildMatureMaturityEvidence({
    maturity: 'IMMATURE',
    reasonCodes: ['MATURITY_FIRST_OBSERVATION'],
    sourcePersistenceState: 'NEW',
    stableEpochObservationCount: 1,
    stableEpochHours: 0,
    persistenceHours: null,
    evidenceCompleteness: 'COMPLETE',
    ...overrides,
  });
}

export function buildCompleteLongitudinalEvidence(
  overrides: Partial<ConfidenceLongitudinalEvidence> = {},
): ConfidenceLongitudinalEvidence {
  const persistence = buildStablePersistenceEvidence();
  const maturity = buildMatureMaturityEvidence({
    sourceObservationId: persistence.sourceObservationId,
    sourceLogicalObservationId: persistence.logicalObservationId,
    sourcePersistenceState: persistence.state,
    persistenceHours: persistence.persistenceHours,
  });

  return {
    persistence,
    maturity,
    governanceConvergence: {
      contextAvailable: true,
      ruleVersion: 'governance-convergence-v1',
    },
    ...overrides,
  };
}
