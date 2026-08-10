import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DemoReportsPage } from './DemoReportsPage';
import { listDemoScenarioIds } from './ec2-demo-scenarios';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function createElements() {
  return {
    stateMessage: document.createElement('p'),
    reportList: document.createElement('div'),
    reportBody: document.createElement('div'),
    verificationPanel: document.createElement('div'),
    reportMeta: document.createElement('div'),
    exportButton: document.createElement('button'),
  };
}

describe('DemoReportsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists all five demo scenarios', () => {
    const page = new DemoReportsPage(createElements());
    page.selectScenario('i-mock-001');
    expect(listDemoScenarioIds().length).toBe(5);
    expect(page.listScenarioIds()).toEqual(listDemoScenarioIds());
  });

  it('selects scenario from ?scenario=i-mock-001 query parameter', () => {
    const page = new DemoReportsPage(createElements());
    page.initializeFromLocation('?scenario=i-mock-001');
    expect(page.getSelectedScenarioId()).toBe('i-mock-001');
    expect(page.getSnapshot()?.scenarioId).toBe('i-mock-001');
  });

  it('defaults invalid scenario query to default scenario', () => {
    const page = new DemoReportsPage(createElements());
    page.initializeFromLocation('?scenario=not-a-real-scenario');
    expect(page.getSelectedScenarioId()).toBe('i-mock-001');
  });

  it('renders executive and decision basis for i-mock-001', () => {
    const elements = createElements();
    const page = new DemoReportsPage(elements);
    page.selectScenario('i-mock-001');
    expect(elements.reportBody.textContent).toContain('Executive Summary');
    expect(elements.reportBody.textContent).toContain('Decision Basis');
    expect(elements.reportBody.textContent).toMatch(/numeric score unavailable/i);
  });

  it('i-mock-003 shows no recommendation confidence in report body', () => {
    const elements = createElements();
    const page = new DemoReportsPage(elements);
    page.selectScenario('i-mock-003');
    expect(elements.reportBody.textContent).toMatch(/Not available for this demo scenario/i);
    expect(elements.reportBody.textContent).toMatch(/No optimization recommendation/i);
  });

  it('NOT_EXECUTED verification panel avoids fake verified savings', () => {
    const elements = createElements();
    const page = new DemoReportsPage(elements);
    page.selectScenario('i-mock-001');
    expect(elements.verificationPanel.textContent).toContain('NOT_EXECUTED');
    expect(elements.verificationPanel.textContent).toContain('Not available — execution not performed');
  });

  it('switching scenarios replaces report content', () => {
    const elements = createElements();
    const page = new DemoReportsPage(elements);
    page.selectScenario('i-mock-001');
    expect(elements.reportMeta.textContent).toContain('i-mock-001');
    page.selectScenario('i-mock-004');
    expect(elements.reportMeta.textContent).toContain('i-mock-004');
    expect(elements.reportMeta.textContent).not.toContain('i-mock-001');
  });

  it('exportSampleJson uses ec2-demo-sample filename convention for selected scenario', () => {
    const elements = createElements();
    const page = new DemoReportsPage(elements);
    page.selectScenario('i-mock-004');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:demo'),
      revokeObjectURL: vi.fn(),
    });
    let capturedDownload = '';
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownload = this.download;
    });
    page.exportSampleJson();
    expect(capturedDownload).toBe('ec2-demo-sample-i-mock-004.json');
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });

  it('demo-reports entry does not use authenticated report APIs', () => {
    const src = readFileSync(join(__dirname, '../demo-reports-main.ts'), 'utf8');
    expect(src).not.toContain('reportApi');
    expect(src).not.toContain('requireAuthentication');
    expect(src).not.toContain('/reports');
    expect(src).not.toContain('/workflows/run');
    expect(src).not.toContain('/analysis/ec2/start');
  });
});
