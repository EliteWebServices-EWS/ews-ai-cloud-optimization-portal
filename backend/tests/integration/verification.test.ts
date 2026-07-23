import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createVerificationEngine } from '../../engines';
import {
  EXECUTION_STATUS,
  PLUGIN_NAMES,
  PROVIDER_NAMES,
  RECOMMENDATION_STATUS,
  VERIFICATION_STATUS,
} from '../../shared/constants';
import type { VerificationRequest } from '../../shared/types';

const TENANT_ID = 'integration-verification-tenant';

function buildVerificationRequest(overrides: Partial<VerificationRequest> = {}): VerificationRequest {
  const base: VerificationRequest = {
    context: {
      tenantId: TENANT_ID,
      workflowId: 'wf-int-verification-001',
      plugin: PLUGIN_NAMES.EC2,
      provider: PROVIDER_NAMES.MOCK,
      region: 'us-east-1',
      mode: 'demo',
      startedAt: new Date().toISOString(),
    },
    recommendation: {
      status: RECOMMENDATION_STATUS.RECOMMENDED,
      summary: 'Rightsize instance from t3.large to t3.medium',
      reason: 'Low CPU utilization',
      detail: {
        action: 'rightsizing',
        fromInstanceType: 't3.large',
        toInstanceType: 't3.medium',
        description: 'Scale down instance size for test workload',
      },
      explanation: {
        governance: 'Approved for test workload',
        financial: 'Estimated 50% monthly savings',
        confidence: 'High confidence based on utilization',
      },
      reasons: [{ code: 'LOW_CPU', message: 'CPU utilization below threshold' }],
    },
    financialImpact: {
      currentMonthlyCost: 72,
      projectedMonthlyCost: 36,
      monthlySavings: 36,
      annualSavings: 432,
      percentageReduction: 50,
      status: 'ESTIMATED',
      currency: 'USD',
      summary: {
        pricing: {
          region: 'us-east-1',
          current: { instanceType: 't3.large', hourlyRate: 0.1, monthlyCost: 72, currency: 'USD' },
          projected: { instanceType: 't3.medium', hourlyRate: 0.05, monthlyCost: 36, currency: 'USD' },
        },
        savings: { monthlySavings: 36, annualSavings: 432, percentageReduction: 50 },
        roi: 50,
        status: 'ESTIMATED',
      },
      currentCost: 72,
      recommendedCost: 36,
      roi: 50,
    },
    executionResult: {
      executionId: 'exec-int-verification-001',
      status: EXECUTION_STATUS.COMPLETED,
      resourceId: 'i-int-001',
      resourceType: 'EC2',
      action: 'rightsizing',
      success: true,
      executedAt: new Date().toISOString(),
      change: { action: 'rightsizing', from: 't3.large', to: 't3.medium', resourceType: 'EC2' },
      previousState: { instanceType: 't3.large' },
      newState: { instanceType: 't3.medium' },
      metadata: {
        tenantId: TENANT_ID,
        workflowId: 'wf-int-verification-001',
        plugin: PLUGIN_NAMES.EC2,
        region: 'us-east-1',
        simulated: true,
        recommendationStatus: RECOMMENDATION_STATUS.RECOMMENDED,
      },
    },
    observation: {
      resourceId: 'i-int-001',
      resourceType: 'EC2',
      region: 'us-east-1',
      collectedAt: new Date().toISOString(),
      instanceType: 't3.medium',
      previousInstanceType: 't3.large',
      monthlyCostBefore: 72,
      monthlyCostAfter: 36,
      observedMonthlySavings: 36,
      metrics: [
        {
          name: 'cpuUtilization',
          expected: 15,
          observed: 15,
          unit: '%',
          matched: true,
        },
      ],
      executionId: 'exec-int-verification-001',
      source: 'simulated',
    },
  };

  return { ...base, ...overrides };
}

describe('Verification integration', () => {
  it('verifies a completed execution and builds a verification report', async () => {
    const engine = createVerificationEngine();
    const request = buildVerificationRequest();
    const result = await engine.execute(request);

    assert.equal(result.success, true);
    assert.equal(result.data?.status, VERIFICATION_STATUS.VERIFIED);
    assert.equal(result.data?.stateMatched, true);

    const report = engine.buildReport(request, result.data!);
    assert.equal(report.workflowId, request.context.workflowId);
    assert.equal(report.status, VERIFICATION_STATUS.VERIFIED);
    assert.ok(report.summary.includes('VERIFIED'));
  });

  it('returns INVALID_OBSERVATION when observation is not provided', async () => {
    const engine = createVerificationEngine();
    const request = buildVerificationRequest();
    const invalidRequest = { ...request, observation: undefined } as unknown as VerificationRequest;

    const result = await engine.execute(invalidRequest);

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'INVALID_OBSERVATION');
  });
});