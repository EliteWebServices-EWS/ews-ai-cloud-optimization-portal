import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportsPage } from './ReportsPage';
import * as reportApi from '../api/reportApi';
import * as freshness from '../ec2-async-job/ec2-async-job-freshness';

function createElements() {
  return {
    stateMessage: document.createElement('div'),
    filtersForm: document.createElement('form'),
    reportList: document.createElement('div'),
    reportDetail: document.createElement('div'),
    summaryPanel: document.createElement('div'),
    savingsPanel: document.createElement('div'),
    recommendationPanel: document.createElement('div'),
    verificationPanel: document.createElement('div'),
    generateButton: document.createElement('button'),
    refreshButton: document.createElement('button'),
  };
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('labels live EC2 async reports from backend reportSource', async () => {
    vi.spyOn(freshness, 'consumeEc2AsyncJobCompletedSignal').mockReturnValue(null);
    vi.spyOn(reportApi, 'listReports').mockResolvedValue({
      total: 1,
      reports: [
        {
          reportId: 'rep-live',
          workflowId: 'ec2-async:job-1',
          plugin: 'ec2',
          status: 'complete',
          workflowStatus: 'completed',
          createdAt: new Date().toISOString(),
          region: 'us-east-1',
          reportSource: 'ec2_async',
          ec2AsyncJobId: 'job-1',
          accountId: '572262081497',
          summary: {
            headline: 'EC2 intelligence complete — no instances',
            opportunityCount: 0,
            estimatedMonthlySavings: 0,
            verifiedMonthlySavings: 0,
            verifiedCount: 0,
            currency: 'USD',
            optimizationStatus: 'complete',
            executiveSummary: 'Analysis completed.',
          },
          resourceCount: 0,
          confidenceStatus: 'NOT_APPLICABLE',
        },
      ],
    });
    vi.spyOn(reportApi, 'getReport').mockResolvedValue({
      reportId: 'rep-live',
      workflowId: 'ec2-async:job-1',
      plugin: 'ec2',
      status: 'complete',
      workflowStatus: 'completed',
      createdAt: new Date().toISOString(),
      region: 'us-east-1',
      reportSource: 'ec2_async',
      ec2AsyncJobId: 'job-1',
      accountId: '572262081497',
      summary: {
        headline: 'EC2 intelligence complete — no instances',
        opportunityCount: 0,
        estimatedMonthlySavings: 0,
        verifiedMonthlySavings: 0,
        verifiedCount: 0,
        currency: 'USD',
        optimizationStatus: 'complete',
        executiveSummary: 'Analysis completed.',
        technicalSummary: 'Job complete.',
      },
      resources: [],
      financialImpact: {
        currentMonthlyCost: 0,
        projectedMonthlyCost: 0,
        estimatedMonthlySavings: 0,
        estimatedAnnualSavings: 0,
        verifiedMonthlySavings: 0,
        percentageReduction: 0,
        currency: 'USD',
        status: 'UNAVAILABLE',
      },
      recommendations: [],
      exportOptions: [],
    });

    const elements = createElements();
    const page = new ReportsPage(elements);
    await page.initialize();

    expect(elements.reportList.textContent).toContain('Live EC2 async');
    expect(elements.recommendationPanel.textContent).toContain('No recommendations');
    expect(elements.reportDetail.textContent).toContain('Live EC2 async analysis');
    expect(elements.reportList.textContent).not.toContain('i-mock-001');
  });

  it('selects the matching live EC2 async report after completion freshness', async () => {
    vi.spyOn(freshness, 'consumeEc2AsyncJobCompletedSignal').mockReturnValue({
      jobId: 'job-live-prefer',
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(reportApi, 'listReports').mockResolvedValue({
      total: 2,
      reports: [
        {
          reportId: 'rep-demo-old',
          workflowId: 'wf-demo',
          plugin: 'ec2',
          status: 'complete',
          workflowStatus: 'completed',
          createdAt: '2026-01-01T00:00:00.000Z',
          region: 'us-east-1',
          reportSource: 'demo',
          summary: {
            headline: 'Resize for i-mock-001',
            opportunityCount: 1,
            estimatedMonthlySavings: 30.37,
            verifiedMonthlySavings: 0,
            verifiedCount: 0,
            currency: 'USD',
            optimizationStatus: 'complete',
            executiveSummary: 'Demo',
          },
          resourceCount: 1,
        },
        {
          reportId: 'rep-live-new',
          workflowId: 'ec2-async:job-live-prefer',
          plugin: 'ec2',
          status: 'complete',
          workflowStatus: 'completed',
          createdAt: '2026-08-01T00:00:00.000Z',
          region: 'us-east-1',
          reportSource: 'ec2_async',
          ec2AsyncJobId: 'job-live-prefer',
          summary: {
            headline: 'EC2 intelligence complete — no instances',
            opportunityCount: 0,
            estimatedMonthlySavings: 0,
            verifiedMonthlySavings: 0,
            verifiedCount: 0,
            currency: 'USD',
            optimizationStatus: 'complete',
            executiveSummary: 'Analysis completed.',
          },
          resourceCount: 0,
          confidenceStatus: 'NOT_APPLICABLE',
        },
      ],
    });
    const getSpy = vi.spyOn(reportApi, 'getReport').mockImplementation(async (reportId) => ({
      reportId,
      workflowId: reportId === 'rep-live-new' ? 'ec2-async:job-live-prefer' : 'wf-demo',
      plugin: 'ec2',
      status: 'complete',
      workflowStatus: 'completed',
      createdAt: new Date().toISOString(),
      region: 'us-east-1',
      reportSource: reportId === 'rep-live-new' ? 'ec2_async' : 'demo',
      ec2AsyncJobId: reportId === 'rep-live-new' ? 'job-live-prefer' : undefined,
      summary: {
        headline: reportId === 'rep-live-new' ? 'EC2 intelligence complete' : 'Demo',
        opportunityCount: reportId === 'rep-live-new' ? 0 : 1,
        estimatedMonthlySavings: reportId === 'rep-live-new' ? 0 : 30.37,
        verifiedMonthlySavings: 0,
        verifiedCount: 0,
        currency: 'USD',
        optimizationStatus: 'complete',
        executiveSummary: 'Summary',
      },
      resources: [],
      financialImpact: {
        currentMonthlyCost: 0,
        projectedMonthlyCost: 0,
        estimatedMonthlySavings: 0,
        estimatedAnnualSavings: 0,
        verifiedMonthlySavings: 0,
        percentageReduction: 0,
        currency: 'USD',
        status: 'UNAVAILABLE',
      },
      recommendations: [],
      exportOptions: [],
    }));

    const page = new ReportsPage(createElements());
    await page.initialize();

    expect(getSpy).toHaveBeenCalledWith('rep-live-new');
    expect(page.getSelectedReport()?.reportSource).toBe('ec2_async');
  });

  it('reloads reports once when EC2 completion signal is present', async () => {
    vi.spyOn(freshness, 'consumeEc2AsyncJobCompletedSignal').mockReturnValue({
      jobId: 'job-complete-1',
      completedAt: new Date().toISOString(),
    });
    const listSpy = vi.spyOn(reportApi, 'listReports').mockResolvedValue({ total: 0, reports: [] });

    const page = new ReportsPage(createElements());
    await page.initialize();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(page.getState()).toBe('success');
  });
});
