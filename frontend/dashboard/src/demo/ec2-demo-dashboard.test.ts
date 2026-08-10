import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ec2DemoDashboard } from './ec2-demo-dashboard';
import { Ec2DashboardController } from '../pages/Ec2DashboardController';
import { PublicDemoEc2DashboardDataProvider } from './public-demo-ec2-dashboard-provider';
import {
  EC2_DEMO_SCENARIOS,
  listDemoScenarioIds,
} from './ec2-demo-scenarios';
import { buildDemoScenarioViewModel } from './ec2-demo-scenario-view-models';

function createPanelElements() {
  return {
    chrome: document.createElement('div'),
    statusBanner: document.createElement('div'),
    summary: document.createElement('div'),
    cost: document.createElement('div'),
    instanceMix: document.createElement('div'),
    security: document.createElement('div'),
    rightsizing: document.createElement('div'),
    executive: document.createElement('div'),
  };
}

function createDemoDashboard() {
  const panels = createPanelElements();
  const provider = new PublicDemoEc2DashboardDataProvider();
  const ec2Controller = new Ec2DashboardController({ provider, panels });
  const scenarioSelect = document.createElement('select');
  const analyzeButton = document.createElement('button');
  const stateMessage = document.createElement('p');
  const exportButton = document.createElement('button');

  const dashboard = new Ec2DemoDashboard(
    { scenarioSelect, analyzeButton, stateMessage, exportButton, panels },
    ec2Controller,
  );

  return { dashboard, ec2Controller, panels, scenarioSelect, analyzeButton, exportButton };
}

describe('Ec2DemoDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runAnalyze(dashboard: Ec2DemoDashboard): Promise<void> {
    const pending = dashboard.analyzeDemoEnvironment();
    await vi.runAllTimersAsync();
    await pending;
  }
  it('lists all predefined demo scenarios in the selector', () => {
    const { scenarioSelect } = createDemoDashboard();
    const optionValues = Array.from(scenarioSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(listDemoScenarioIds());
    expect(optionValues.length).toBe(EC2_DEMO_SCENARIOS.length);
  });

  it('starts in ready demo state with disclosure message', () => {
    const { dashboard, panels } = createDemoDashboard();
    expect(dashboard.getAnalysisState()).toBe('ready');
    expect(panels.summary.textContent).toContain('');
    expect(document.body.textContent ?? panels.chrome.textContent).toBeDefined();
  });

  it('does not call fetch or live EC2 start when analyzing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { dashboard, scenarioSelect } = createDemoDashboard();
    scenarioSelect.value = 'i-mock-001';
    await runAnalyze(dashboard);

    expect(fetchSpy).not.toHaveBeenCalled();
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes('/analysis/ec2/start'))).toBe(false);
    fetchSpy.mockRestore();
  });

  it('renders scenario A then replaces with scenario B results', async () => {
    const { dashboard, scenarioSelect, panels } = createDemoDashboard();

    scenarioSelect.value = 'i-mock-001';
    await runAnalyze(dashboard);
    expect(panels.rightsizing.textContent).toContain('i-mock-001');
    expect(panels.cost.textContent).toContain('30.37');

    scenarioSelect.value = 'i-mock-004';
    await runAnalyze(dashboard);
    expect(panels.cost.textContent).toContain('124.1');
    expect(panels.rightsizing.textContent).toContain('i-mock-004');
    expect(panels.rightsizing.textContent).not.toContain('i-mock-001');
  });

  it('updates cost, security, and recommendations for mock-002', async () => {
    const { dashboard, scenarioSelect, panels } = createDemoDashboard();
    scenarioSelect.value = 'i-mock-002';
    await runAnalyze(dashboard);

    expect(panels.cost.textContent).toMatch(/70\.08|m5/i);
    expect(panels.security.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(panels.rightsizing.textContent).toContain('i-mock-002');
  });

  it('shows zero recommendations for mock-003 (no mock resize rec)', async () => {
    const { dashboard, scenarioSelect, panels } = createDemoDashboard();
    scenarioSelect.value = 'i-mock-003';
    await runAnalyze(dashboard);
    const vm = buildDemoScenarioViewModel('i-mock-003');
    expect(vm.cost.recommendations).toHaveLength(0);
    expect(panels.executive.textContent).toMatch(/no mock|balanced/i);
  });

  it('exports JSON aligned with analyzed scenario', async () => {
    const { dashboard, ec2Controller, scenarioSelect } = createDemoDashboard();
    scenarioSelect.value = 'i-mock-004';
    await runAnalyze(dashboard);

    const json = ec2Controller.exportJsonReport();
    expect(json).toBeTruthy();
    expect(json).toContain('i-mock-004');
    expect(json).not.toContain('572262081497');
  });

  it('includes all four mock candidate scenarios', () => {
    const ids = listDemoScenarioIds();
    expect(ids).toContain('i-mock-001');
    expect(ids).toContain('i-mock-002');
    expect(ids).toContain('i-mock-003');
    expect(ids).toContain('i-mock-004');
  });
});
