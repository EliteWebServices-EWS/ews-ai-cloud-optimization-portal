import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConfidenceEngine } from '../../engines/confidence';
import {
  EVIDENCE_STATUS,
  FINANCIAL_STATUS,
  GOVERNANCE_STATUS,
  READINESS_STATUS,
} from '../../shared/constants';
import type {
  ConfidenceRequest,
  EvidenceValidationResult,
  StandardizedEvidence,
} from '../../shared/types';
import {
  buildHealthyEvidence,
  buildHealthyValidation,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from '../fixtures/evidence';

const RESOURCE_ID = RESOURCE_ID_CONFIDENCE_GOLDEN;

const evidence: StandardizedEvidence = buildHealthyEvidence();
const validation: EvidenceValidationResult = buildHealthyValidation();

function buildRequest(
  overrides: Partial<Pick<ConfidenceRequest, 'evidence' | 'evidenceStatus' | 'validation'>> = {}
): ConfidenceRequest {
  return {
    context: {
      tenantId: 'tenant-a',
      workflowId: 'workflow-confidence-engine',
      plugin: 'ec2',
      provider: 'mock',
      region: 'us-east-1',
      mode: 'demo',
      startedAt: '2026-08-07T00:00:00.000Z',
    },
    candidate: {
      resourceId: RESOURCE_ID,
      resourceType: 'EC2',
      region: 'us-east-1',
    },
    evidence,
    evidenceStatus: EVIDENCE_STATUS.COMPLETE,
    validation,
    governance: {
      status: READINESS_STATUS.READY,
      decision: GOVERNANCE_STATUS.APPROVED,
      readinessScore: 100,
      readiness: {
        score: 100,
        status: READINESS_STATUS.READY,
        factors: [],
      },
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
    ...overrides,
  };
}

describe('confidence engine evidence boundaries', () => {
  it('fails closed when evidence is missing', async () => {
    const engine = createConfidenceEngine();
    const result = await engine.execute(
      buildRequest({
        evidence: undefined as unknown as StandardizedEvidence,
      })
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'INVALID_EVIDENCE');
  });

  it('fails closed when evidence status is incomplete', async () => {
    const engine = createConfidenceEngine();
    const result = await engine.execute(
      buildRequest({
        evidenceStatus: EVIDENCE_STATUS.INCOMPLETE,
      })
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'INVALID_EVIDENCE');
    assert.match(result.error?.reason ?? '', /incomplete/i);
  });

  it('returns formula version and threshold status for valid evidence', async () => {
    const engine = createConfidenceEngine();
    const result = await engine.execute(buildRequest());

    assert.equal(result.success, true);
    assert.equal(result.data?.score, 100);
    assert.equal(result.data?.status, 'HIGH');
    assert.equal(result.data?.formulaVersion, 'commercial-weighted-v1');
  });
});
