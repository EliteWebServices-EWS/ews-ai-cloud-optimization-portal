/**
 * Reporting Engine unit tests.
 * Sprint 9: validates report generation, filtering, and error handling.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReportingEngine,
  filterReports,
  generateExecutiveSummary,
  generateReport,
  generateTechnicalSummary,
} from '../../engines/reporting';
import {
  CONFIDENCE_STATUS,
  PLUGIN_NAMES,
  RECOMMENDATION_STATUS,
  VERIFICATION_STATUS,
  WORKFLOW_STATES,
} from '../../shared/constants';
import type { ReportGenerationInput } from '../../shared/types';

const TENANT_ID = 'sisum-default';

function buildCompleteInput(overrides: Partial<ReportGenerationInput> = {}): ReportGenerationInput {
  return {
    tenantId: TENANT_ID,
    workflowId: 'wf-test-001',
    plugin: PLUGIN_NAMES.EC2,
    status: WORKFLOW_STATES.COMPLETED,
    region: 'us-east-1',
    completedAt: '2026-07-09T12:00:00.000Z',
    candidate: {
      resourceId: 'i-mock-001',
      resourceType: 'EC2',
      region: 'us-east-1',
      tags: { Environment: 'development' },
    },
    evidenceStatus: 'complete',
    validation: { valid: true, errors: [], warnings: [] },
    evidence: {
      telemetry: {
        cpuUtilization: 12,
        memoryUtilization: 34,
        observationWindowDays: 14,
      },
      metrics: {
        cpuUtilization: [10, 12, 15],
        memoryUtilization: [30, 34, 32],
        period: '1h',
        datapoints: 3,
        utilizationHistory: [],
      },
      pricing: {
        instanceType: 't3.large',
        region: 'us-east-1',
        hourlyRate: 0.0832,
        monthlyRate: 60.74,
        currency: 'USD',
      },
      recommendations: [
        {
          resourceId: 'i-mock-001',
          resourceType: 'EC2',
          action: 'rightsizing',
          target: 't3.medium',
          reason: 'Low CPU utilization',
        },
      ],
      tags: { Environment: 'development' },
      instance: {
        instanceId: 'i-mock-001',
        instanceType: 't3.large',
        state: 'running',
        region: 'us-east-1',
        launchTime: '2026-01-01T00:00:00.000Z',
      },
      collectedAt: '2026-07-09T11:00:00.000Z',
    },
    governance: {
      status: 'READY',
      decision: 'approved',
      readinessScore: 92,
      readiness: { score: 92, status: 'READY', factors: [] },
      reason: 'Development environment — auto-approved',
      policies: [],
    },
    financialImpact: {
      currentMonthlyCost: 60.74,
      projectedMonthlyCost: 30.37,
      monthlySavings: 30.37,
      annualSavings: 364.44,
      percentageReduction: 50,
      status: 'ESTIMATED',
      currency: 'USD',
      summary: {
        pricing: {
          region: 'us-east-1',
          current: { instanceType: 't3.large', hourlyRate: 0.0832, monthlyCost: 60.74, currency: 'USD' },
          projected: { instanceType: 't3.medium', hourlyRate: 0.0416, monthlyCost: 30.37, currency: 'USD' },
        },
        savings: { monthlySavings: 30.37, annualSavings: 364.44, percentageReduction: 50 },
        roi: 50,
        status: 'ESTIMATED',
      },
      currentCost: 60.74,
      recommendedCost: 30.37,
      roi: 50,
    },
    confidence: {
      score: 88,
      status: CONFIDENCE_STATUS.HIGH,
      reason: 'Stable utilization pattern',
      factors: [],
      level: 'high',
    },
    recommendation: {
      status: RECOMMENDATION_STATUS.RECOMMENDED,
      summary: 'Rightsize t3.large to t3.medium',
      reason: 'Consistently low CPU utilization supports downsizing',
      detail: {
        action: 'rightsizing',
        fromInstanceType: 't3.large',
        toInstanceType: 't3.medium',
        description: 'Reduce instance size based on utilization evidence',
      },
      explanation: {
        governance: 'Approved for development',
        financial: 'Estimated 50% monthly savings',
        confidence: 'High confidence based on stable metrics',
      },
      reasons: [{ code: 'LOW_CPU', message: 'CPU below threshold' }],
    },
    execution: {
      executionId: 'exec-test-001',
      status: 'COMPLETED',
      resourceId: 'i-mock-001',
      resourceType: 'EC2',
      action: 'rightsizing',
      success: true,
      executedAt: '2026-07-09T11:30:00.000Z',
      change: { action: 'rightsizing', from: 't3.large', to: 't3.medium', resourceType: 'EC2' },
      previousState: { instanceType: 't3.large' },
      newState: { instanceType: 't3.medium' },
      metadata: {
        tenantId: TENANT_ID,
        workflowId: 'wf-test-001',
        plugin: PLUGIN_NAMES.EC2,
        region: 'us-east-1',
        simulated: true,
        recommendationStatus: RECOMMENDATION_STATUS.RECOMMENDED,
      },
    },
    verification: {
      status: VERIFICATION_STATUS.VERIFIED,
      expectedSavings: 30.37,
      actualSavings: 29.9,
      verifiedSavings: 29.9,
      variance: -0.47,
      variancePercentage: -1.5,
      stateMatched: true,
      message: 'Verification successful',
    },
    ...overrides,
  };
}

describe('ReportingEngine', () => {
  let engine: ReturnType<typeof createReportingEngine>;

  beforeEach(() => {
    engine = createReportingEngine();
  });

  it('generates a complete optimization report from workflow data', () => {
    const input = buildCompleteInput();
    const result = engine.execute(input);

    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.ok(result.data.reportId.startsWith('rpt-'));
    assert.equal(result.data.workflowId, 'wf-test-001');
    assert.equal(result.data.status, 'complete');
    assert.equal(result.data.resources.length, 1);
    assert.equal(result.data.recommendations.length, 1);
    assert.equal(result.data.financialImpact.estimatedMonthlySavings, 30.37);
    assert.equal(result.data.verification?.status, VERIFICATION_STATUS.VERIFIED);
    assert.ok(result.data.summary.executiveSummary.includes('optimization opportunity'));
    assert.ok(result.data.exportOptions.some((opt) => opt.format === 'json' && opt.available));
  });

  it('handles empty workflow with no candidate', () => {
    const input = buildCompleteInput({
      candidate: undefined,
      recommendation: undefined,
      financialImpact: undefined,
      verification: undefined,
    });

    const report = generateReport(input);
    assert.equal(report.status, 'empty');
    assert.equal(report.resources.length, 0);
    assert.equal(report.summary.opportunityCount, 0);
    assert.match(report.summary.executiveSummary, /No optimization opportunities/);
  });

  it('handles incomplete workflow data as partial report', () => {
    const input = buildCompleteInput({
      verification: undefined,
      execution: undefined,
    });

    const report = generateReport(input);
    assert.equal(report.status, 'partial');
    assert.ok(report.recommendations.length > 0);
    assert.equal(report.verification, undefined);
  });

  it('supports multiple recommendation entries when data is present', () => {
    const input = buildCompleteInput();
    const report = generateReport(input);
    assert.equal(report.recommendations.length, 1);
    assert.equal(report.recommendations[0].decision.confidenceStatus, CONFIDENCE_STATUS.HIGH);
  });

  it('handles failed verification status', () => {
    const input = buildCompleteInput({
      verification: {
        status: VERIFICATION_STATUS.FAILED,
        expectedSavings: 30.37,
        actualSavings: 5,
        verifiedSavings: 0,
        variance: -25.37,
        variancePercentage: -83.5,
        stateMatched: false,
        message: 'Significant savings variance detected',
      },
    });

    const report = generateReport(input);
    assert.equal(report.verification?.status, VERIFICATION_STATUS.FAILED);
    assert.equal(report.summary.verifiedCount, 0);
    assert.equal(report.financialImpact.verifiedMonthlySavings, 0);
  });

  it('rejects report generation without workflow ID', () => {
    const input = buildCompleteInput({ workflowId: '' });
    const result = engine.execute(input);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'MISSING_WORKFLOW');
  });

  it('filters reports by confidence level', () => {
    const highInput = buildCompleteInput({ workflowId: 'wf-high' });
    const lowInput = buildCompleteInput({
      workflowId: 'wf-low',
      confidence: {
        score: 40,
        status: CONFIDENCE_STATUS.LOW,
        reason: 'Volatile metrics',
        factors: [],
        level: 'low',
      },
    });

    engine.execute(highInput);
    engine.execute(lowInput);

    const filtered = filterReports(engine.listReports(TENANT_ID), { confidenceLevel: 'HIGH' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].workflowId, 'wf-high');
  });

  it('generates executive and technical summaries via templates', () => {
    const input = buildCompleteInput();
    const executive = generateExecutiveSummary(input);
    const technical = generateTechnicalSummary(input);

    assert.match(executive, /optimization opportunity identified/);
    assert.match(executive, /Estimated monthly savings/);
    assert.match(technical, /Analyzed EC2 resource/);
    assert.match(technical, /Evidence collected/);
    assert.match(technical, /Governance/);
  });
});
