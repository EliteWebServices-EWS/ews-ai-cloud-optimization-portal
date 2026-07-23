import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createReportingEngine } from '../../engines';
import {
  CONFIDENCE_STATUS,
  PLUGIN_NAMES,
  RECOMMENDATION_STATUS,
  VERIFICATION_STATUS,
  WORKFLOW_STATES,
} from '../../shared/constants';
import type { ReportGenerationInput } from '../../shared/types';

const TENANT_ID = 'integration-report-tenant';

function buildCompleteInput(): ReportGenerationInput {
  return {
    tenantId: TENANT_ID,
    workflowId: 'wf-int-report-001',
    plugin: PLUGIN_NAMES.EC2,
    status: WORKFLOW_STATES.COMPLETED,
    region: 'us-east-1',
    completedAt: new Date().toISOString(),
    candidate: {
      resourceId: 'i-int-001',
      resourceType: 'EC2',
      region: 'us-east-1',
      tags: { Environment: 'test' },
    },
    evidenceStatus: 'complete',
    evidence: {
      telemetry: {
        cpuUtilization: 15,
        memoryUtilization: 30,
        observationWindowDays: 7,
      },
      metrics: {
        cpuUtilization: [15],
        memoryUtilization: [30],
        period: '1h',
        datapoints: 1,
        utilizationHistory: [],
      },
      pricing: {
        instanceType: 't3.large',
        region: 'us-east-1',
        hourlyRate: 0.1,
        monthlyRate: 72,
        currency: 'USD',
      },
      recommendations: [
        {
          resourceId: 'i-int-001',
          resourceType: 'EC2',
          action: 'rightsizing',
          target: 't3.medium',
          reason: 'Low CPU utilization',
        },
      ],
      tags: { Environment: 'test' },
      instance: {
        instanceId: 'i-int-001',
        instanceType: 't3.large',
        state: 'running',
        region: 'us-east-1',
        launchTime: new Date().toISOString(),
      },
      collectedAt: new Date().toISOString(),
    },
    governance: {
      status: 'READY',
      decision: 'approved',
      readinessScore: 90,
      readiness: { score: 90, status: 'READY', factors: [] },
      reason: 'Auto-approved test workflow',
      policies: [],
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
    confidence: {
      score: 85,
      status: CONFIDENCE_STATUS.HIGH,
      reason: 'Stable utilization pattern',
      factors: [],
      level: 'high',
    },
    recommendation: {
      status: RECOMMENDATION_STATUS.RECOMMENDED,
      summary: 'Rightsize instance from t3.large to t3.medium',
      reason: 'Low CPU utilization supports a smaller instance',
      detail: {
        action: 'rightsizing',
        fromInstanceType: 't3.large',
        toInstanceType: 't3.medium',
        description: 'Reduce instance size based on utilization evidence',
      },
      explanation: {
        governance: 'Approved for test workload',
        financial: 'Estimated 50% monthly savings',
        confidence: 'High confidence based on utilization stability',
      },
      reasons: [{ code: 'LOW_CPU', message: 'CPU utilization below threshold' }],
    },
    execution: {
      executionId: 'exec-int-report-001',
      status: 'COMPLETED',
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
        workflowId: 'wf-int-report-001',
        plugin: PLUGIN_NAMES.EC2,
        region: 'us-east-1',
        simulated: true,
        recommendationStatus: RECOMMENDATION_STATUS.RECOMMENDED,
      },
    },
    verification: {
      status: VERIFICATION_STATUS.VERIFIED,
      expectedSavings: 36,
      actualSavings: 36,
      verifiedSavings: 36,
      variance: 0,
      variancePercentage: 0,
      stateMatched: true,
      message: 'Verification successful',
    },
  };
}

describe('Reporting integration', () => {
  it('generates, retrieves, lists, and deletes a report', async () => {
    const engine = createReportingEngine();
    const input = buildCompleteInput();
    const result = await engine.execute(input);

    assert.equal(result.success, true);
    assert.ok(result.data);

    const report = result.data!;
    assert.equal(report.workflowId, input.workflowId);
    assert.equal(report.tenantId, TENANT_ID);

    const stored = await engine.getReport(TENANT_ID, report.reportId);
    assert.ok(stored);
    assert.equal(stored?.reportId, report.reportId);

    const byWorkflow = await engine.getReportByWorkflowId(TENANT_ID, input.workflowId);
    assert.ok(byWorkflow);
    assert.equal(byWorkflow?.reportId, report.reportId);

    assert.equal((await engine.listReports(TENANT_ID)).length, 1);
    assert.equal(await engine.getRepository().delete(TENANT_ID, report.reportId), true);
    assert.equal(await engine.getReport(TENANT_ID, report.reportId), undefined);
    assert.equal((await engine.listReports(TENANT_ID)).length, 0);
  });
});
