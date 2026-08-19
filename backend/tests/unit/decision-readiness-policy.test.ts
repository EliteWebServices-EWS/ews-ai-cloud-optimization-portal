import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DECISION_READINESS_REASON } from '../../decision-readiness/reason-codes';
import { evaluateSprint2DecisionReadiness } from '../../decision-readiness/readiness-policy';
import {
  buildGovernanceMissingContext,
  buildGovernancePreservedContext,
  buildHighConfidenceMatureEvidenceInput,
} from '../fixtures/evidence';

describe('Sprint 2 decision-readiness policy', () => {
  it('returns READY only when all conservative gates pass', () => {
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = evaluateSprint2DecisionReadiness({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: 'fk',
      recommendationCategory: 'BURSTABLE_CREDIT_PRESSURE',
      recommendationId: 'rec-1',
      recommendedAction: 'Rightsize',
      resourceId: evidence.resourceId,
      evaluatedAt: '2026-08-12T12:00:00.000Z',
      validation: evidence.validation,
      longitudinalEvidenceAvailable: true,
      persistence: {
        state: 'STABLE',
        persistenceHours: 24,
        reasonCodes: ['PERSISTENCE_FINGERPRINT_UNCHANGED'],
        sourceObservationId: 'obs-1',
        logicalObservationId: 'log-1',
        ruleId: 'ec2-cost-underutilized',
        ruleVersion: '1.0.0',
      },
      maturity: {
        maturity: 'MATURE',
        reasonCodes: ['MATURITY_STABLE_HISTORY_SUPPORTS_MATURE'],
        modelVersion: 'evidence-maturity-v1',
        sourceObservationId: 'obs-1',
        sourceLogicalObservationId: 'log-1',
        stableEpochObservationCount: 3,
        stableEpochHours: 30,
        persistenceHours: 24,
      },
      governance: { convergence: buildGovernancePreservedContext() },
      confidence: {
        status: 'HIGH',
        score: 100,
        commercialScore: 100,
        reasonCodes: ['CONFIDENCE_PERSISTENCE_STABLE'],
        formulaVersion: 'commercial-weighted-v1',
        confidenceModelVersion: 'confidence-evidence-aware-v2',
      },
    });

    assert.equal(result.readiness, 'READY');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.READY));
  });

  it('returns NOT_READY when governance convergence is MISSING', () => {
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = evaluateSprint2DecisionReadiness({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey: 'fk',
      recommendationCategory: 'BURSTABLE_CREDIT_PRESSURE',
      recommendationId: 'rec-1',
      recommendedAction: 'Rightsize',
      resourceId: evidence.resourceId,
      evaluatedAt: '2026-08-12T12:00:00.000Z',
      validation: evidence.validation,
      longitudinalEvidenceAvailable: true,
      persistence: {
        state: 'STABLE',
        persistenceHours: 24,
        reasonCodes: [],
        sourceObservationId: 'obs-1',
        logicalObservationId: 'log-1',
        ruleId: 'ec2-cost-underutilized',
        ruleVersion: '1.0.0',
      },
      maturity: {
        maturity: 'MATURE',
        reasonCodes: [],
        modelVersion: 'evidence-maturity-v1',
        sourceObservationId: 'obs-1',
        sourceLogicalObservationId: 'log-1',
        stableEpochObservationCount: 3,
        stableEpochHours: 30,
        persistenceHours: 24,
      },
      governance: { convergence: buildGovernanceMissingContext() },
      confidence: {
        status: 'HIGH',
        score: 100,
        commercialScore: 100,
        reasonCodes: [],
        formulaVersion: 'commercial-weighted-v1',
        confidenceModelVersion: 'confidence-evidence-aware-v2',
      },
    });

    assert.equal(result.readiness, 'NOT_READY');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.GOVERNANCE_CONVERGENCE_MISSING));
  });
});
