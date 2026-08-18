import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecommendationDecision } from '../../engines/recommendation/recommendation.decision';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../../engines/recommendation/recommendation.config';
import {
  CONFIDENCE_STATUS,
  FINANCIAL_STATUS,
  GOVERNANCE_STATUS,
  READINESS_STATUS,
  RECOMMENDATION_STATUS,
} from '../../shared/constants';
import type { RecommendationInput } from '../../engines/recommendation/recommendation.decision';
import { buildConfidenceResult, buildHealthyEvidence } from '../fixtures/evidence';

function buildInput(
  confidenceOverrides: Parameters<typeof buildConfidenceResult>[0] = {},
): RecommendationInput {
  const evidence = buildHealthyEvidence();
  return {
    candidate: {
      resourceId: evidence.recommendations[0]!.resourceId,
      resourceType: 'EC2',
      region: 'us-east-1',
    },
    evidence,
    governance: {
      status: READINESS_STATUS.READY,
      decision: GOVERNANCE_STATUS.APPROVED,
      readinessScore: 100,
      readiness: { score: 100, status: READINESS_STATUS.READY, factors: [] },
      reason: 'Governance passed',
      policies: [],
    },
    financialImpact: {
      currentMonthlyCost: 30,
      projectedMonthlyCost: 24,
      monthlySavings: 6,
      annualSavings: 72,
      percentageReduction: 20,
      status: FINANCIAL_STATUS.ESTIMATED,
      currency: 'USD',
      summary: {
        pricing: {
          region: 'us-east-1',
          current: {
            instanceType: 't3.medium',
            hourlyRate: 0.0416,
            monthlyCost: 30,
            currency: 'USD',
          },
          projected: {
            instanceType: 't3.small',
            hourlyRate: 0.0208,
            monthlyCost: 24,
            currency: 'USD',
          },
        },
        savings: {
          monthlySavings: 6,
          annualSavings: 72,
          percentageReduction: 20,
        },
        roi: 20,
        status: FINANCIAL_STATUS.ESTIMATED,
      },
      currentCost: 30,
      recommendedCost: 24,
      roi: 20,
    },
    confidence: buildConfidenceResult(confidenceOverrides),
    config: DEFAULT_RECOMMENDATION_CONFIG,
  };
}

describe('RecommendationEngine qualified confidence semantics', () => {
  it('respects qualified LOW status when raw commercial score is 100', () => {
    const decision = deriveRecommendationDecision(
      buildInput({
        score: 100,
        commercialScore: 100,
        status: CONFIDENCE_STATUS.LOW,
        level: 'low',
        reason: 'Immature evidence',
      }),
    );

    assert.equal(decision.status, RECOMMENDATION_STATUS.NOT_RECOMMENDED);
    assert.ok(decision.reasons.some((reason) => reason.code === 'LOW_CONFIDENCE'));
  });

  it('respects qualified MEDIUM status when raw commercial score is 100', () => {
    const decision = deriveRecommendationDecision(
      buildInput({
        score: 100,
        commercialScore: 100,
        status: CONFIDENCE_STATUS.MEDIUM,
        level: 'medium',
        reason: 'Partial evidence',
      }),
    );

    assert.equal(decision.status, RECOMMENDATION_STATUS.RECOMMENDED);
  });

  it('defers when qualified MEDIUM status combines with limited savings percentage', () => {
    const input = buildInput({
      score: 100,
      commercialScore: 100,
      status: CONFIDENCE_STATUS.MEDIUM,
      level: 'medium',
      reason: 'Partial evidence',
    });
    input.financialImpact.percentageReduction = 3;

    const decision = deriveRecommendationDecision(input);

    assert.equal(decision.status, RECOMMENDATION_STATUS.DEFERRED);
    assert.ok(decision.reasons.some((reason) => reason.code === 'MODERATE_CONFIDENCE_LOW_SAVINGS'));
  });
});
