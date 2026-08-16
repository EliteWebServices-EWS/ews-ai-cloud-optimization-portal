import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicDemoEc2DashboardDataProvider } from '../demo/public-demo-ec2-dashboard-provider';
import { buildCuratedEc2DemoViewModel } from '../demo/ec2-demo-data';
import { LiveEc2DashboardDataProvider } from '../live/live-ec2-dashboard-provider';
import {
  mapViewModelToCostBreakdown,
  mapViewModelToEc2Summary,
  mapViewModelToInstanceMix,
  maskAccountId,
} from '../ec2/ec2-dashboard-view-model';
import { renderEc2DashboardChrome, renderEc2DashboardPanels } from '../ec2/render-ec2-dashboard';
import { Ec2DashboardController } from '../pages/Ec2DashboardController';
import type { Ec2DashboardDataProvider } from '../ec2/ec2-dashboard-provider';
import * as ec2Api from '../live/ec2-dashboard-api';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('PublicDemoEc2DashboardDataProvider', () => {
  it('does not call fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = new PublicDemoEc2DashboardDataProvider();
    const vm = await provider.loadDashboard({});
    expect(vm.mode).toBe('demo');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('uses synthetic demo resource identifiers for fleet scenario', async () => {
    const vm = await new PublicDemoEc2DashboardDataProvider().loadDashboard({
      demoScenarioId: 'illustrative-fleet',
    });
    const ids = JSON.stringify(vm);
    expect(ids).toMatch(/i-demo-ec2/);
    expect(ids).not.toMatch(/572262081497/);
    expect(ids).not.toMatch(/tenant-msddsjji/);
  });

  it('loads mock candidate scenario without live identifiers', async () => {
    const vm = await new PublicDemoEc2DashboardDataProvider().loadDashboard({
      demoScenarioId: 'i-mock-001',
    });
    expect(vm.demoScenarioId).toBe('i-mock-001');
    expect(JSON.stringify(vm)).toContain('i-mock-001');
    expect(JSON.stringify(vm)).not.toMatch(/572262081497/);
  });
});

describe('demo UI rendering', () => {
  let chrome: HTMLElement;

  beforeEach(() => {
    chrome = document.createElement('div');
  });

  it('shows DEMO DATA badge and illustrative notice', async () => {
    const vm = await new PublicDemoEc2DashboardDataProvider().loadDashboard({});
    renderEc2DashboardChrome(chrome, vm, { showSignInCta: true });
    expect(chrome.textContent).toContain('DEMO DATA');
    expect(chrome.textContent).toContain('Illustrative EC2 environment');
    expect(chrome.textContent).toContain('Sign in');
  });

  it('labels sample report watermark in demo view model', () => {
    const vm = buildCuratedEc2DemoViewModel();
    expect(vm.reports.label).toBe('SAMPLE REPORT');
    expect(vm.reports.watermark).toContain('SAMPLE REPORT');
  });
});

describe('LiveEc2DashboardDataProvider', () => {
  it('maps zero-instance summary honestly', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: {},
      instancesByRegion: { 'us-east-1': 0 },
      instancesByInstanceType: {},
      resourcesByType: { NETWORK_INTERFACE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'test-token',
      accountId: '111122223333',
    });

    expect(vm.mode).toBe('live');
    expect(vm.inventory.totalInstances).toBe(0);
    expect(vm.inventory.runningInstances).toBe(0);
    expect(vm.inventory.stoppedInstances).toBe(0);
    expect(vm.inventory.resourcesByType.NETWORK_INTERFACE).toBe(1);
    expect(vm.sourceLabel).toBe('LIVE AWS DATA');

    const summary = mapViewModelToEc2Summary(vm);
    expect(summary.totalInstances).toBe(0);
    expect(summary.runningInstances).toBe(0);
    expect(mapViewModelToInstanceMix(vm).byFamily).toHaveLength(0);
  });

  it('never imports demo provider on API failure', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('ENGINE_ERROR', 'Failed', 500),
    );
    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'test-token',
      accountId: '111122223333',
    });
    expect(vm.dataStatus).toBe('ERROR');
    expect(vm.mode).toBe('live');
    expect(vm.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(vm)).not.toContain('DEMO DATA');
  });

  it('marks security as not analyzed when summary API returns 404', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 0,
      instancesByState: {},
      instancesByRegion: {},
      instancesByInstanceType: {},
      resourcesByType: {},
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });
    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '999988887777',
    });
    expect(vm.security.status).toBe('NOT_ANALYZED');
    expect(vm.security.findings).toHaveLength(0);
  });

  it('renders account-wide aggregated open finding counts from live security summary', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 2,
      instancesByState: { running: 2 },
      instancesByRegion: { 'us-east-1': 2 },
      instancesByInstanceType: { 't3.micro': 2 },
      resourcesByType: { INSTANCE: 2 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: { validatedMonthlySavings: 0, sampleEstimateMonthlySavings: 0, currency: 'USD' },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockResolvedValue({
      scope: 'account',
      regionsIncluded: ['eu-west-1', 'us-east-1'],
      scoreAvailability: 'complete',
      securityScore: 75,
      governanceScore: 80,
      complianceScore: 77,
      riskLevel: 'medium',
      instancesAnalyzed: 4,
      openFindingCount: 5,
      findingsBySeverity: { critical: 1, high: 2, medium: 1, low: 1 },
      analyzedAt: '2026-02-01T00:00:00.000Z',
    });
    vi.spyOn(ec2Api, 'fetchEc2SecurityFindings').mockResolvedValue({ items: [] });
    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    expect(vm.security.status).toBe('READY');
    expect(vm.executive.securityRisk).toContain('5 open findings');
    expect(vm.accountIdSuffix).toMatch(/••••/);
    expect(vm.accountIdSuffix).not.toContain('111122223333');
  });

  it('renders PARTIAL security when scoreAvailability is partial', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: { validatedMonthlySavings: 0, sampleEstimateMonthlySavings: 0, currency: 'USD' },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockResolvedValue({
      scope: 'region',
      region: 'us-east-1',
      regionsIncluded: ['us-east-1'],
      scoreAvailability: 'partial',
      securityScore: 70,
      governanceScore: 70,
      complianceScore: 70,
      riskLevel: 'medium',
      instancesAnalyzed: 1,
      openFindingCount: 0,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      analyzedAt: '2026-02-01T00:00:00.000Z',
      warnings: ['partial region coverage'],
    });
    vi.spyOn(ec2Api, 'fetchEc2SecurityFindings').mockResolvedValue({ items: [] });
    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
    });
    expect(vm.security.status).toBe('PARTIAL');
  });

  it('maps live rightsizing without NaN utilization or zero-placeholder savings', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [
        {
          recommendationId: 'rec-burst',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceId: 'i-0ce183611f7fc8ed2',
          category: 'BURSTABLE_CREDIT_PRESSURE',
          severity: 'MEDIUM',
          confidenceLevel: 'MEDIUM',
          title: 'Burstable credit pressure',
          summary: 'T-family credit balance or surplus charges indicate burst pressure.',
          businessJustification: 'Credit exhaustion can throttle performance.',
          recommendedAction:
            'Review workload steady-state CPU; consider instance family change after approval.',
          pricingStatus: 'UNAVAILABLE',
          currentInstanceType: 't3.micro',
        },
        {
          recommendationId: 'rec-downsize',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceId: 'i-downsize-001',
          category: 'REVIEW_DOWNSIZE',
          severity: 'MEDIUM',
          confidenceLevel: 'MEDIUM',
          title: 'Low utilization running instance',
          summary: 'Sustained low CPU may indicate idle capacity.',
          businessJustification: 'Rightsize after review.',
          recommendedAction: 'Review downsizing after approval.',
          pricingStatus: 'VERIFIED_RATE',
          currentInstanceType: 'm6i.large',
          candidateInstanceType: 't3.medium',
          estimatedMonthlySavings: 124.5,
        },
      ],
      savingsSummary: {
        validatedMonthlySavings: 124.5,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(vm.averageCpuUtilization).toBeUndefined();
    expect(vm.optimization.rightsizing).toHaveLength(2);

    const burst = vm.optimization.rightsizing.find((row) => row.instanceId === 'i-0ce183611f7fc8ed2');
    expect(burst?.currentType).toBe('t3.micro');
    expect(burst?.recommendedType).toContain('Review workload steady-state CPU');
    expect(burst?.utilization).toBeUndefined();
    expect(burst?.savings).toBeUndefined();

    const downsize = vm.optimization.rightsizing.find((row) => row.instanceId === 'i-downsize-001');
    expect(downsize?.currentType).toBe('m6i.large');
    expect(downsize?.recommendedType).toBe('t3.medium');
    expect(downsize?.savings).toBe(124.5);
    expect(downsize?.utilization).toBeUndefined();
    expect(vm.cost.pricingStatus).toBe('UNAVAILABLE');
    expect(vm.cost.estimatedMonthlyCost).toBeUndefined();
  });

  it('maps AVAILABLE performanceSummary to averageCpuUtilization and analyzedAt', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
      performanceSummary: {
        availability: 'AVAILABLE',
        averageCpuUtilizationPercent: 4.27,
        instancesEvaluated: 1,
        instancesWithMetrics: 1,
        instancesIncludedInAverage: 1,
        analysisRunId: 'run-live',
        analyzedAt: '2026-08-15T01:00:00.000Z',
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(vm.averageCpuUtilization).toBe(4.27);
    expect(vm.latestCostAnalysisAt).toBe('2026-08-15T01:00:00.000Z');
  });

  it('maps PARTIAL performanceSummary with finite average', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 2,
      instancesByState: { running: 2 },
      instancesByRegion: { 'us-east-1': 2 },
      instancesByInstanceType: { 't3.micro': 2 },
      resourcesByType: { INSTANCE: 2 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
      performanceSummary: {
        availability: 'PARTIAL',
        averageCpuUtilizationPercent: 6,
        instancesEvaluated: 2,
        instancesWithMetrics: 1,
        instancesIncludedInAverage: 1,
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(vm.averageCpuUtilization).toBe(6);
  });

  it('leaves averageCpuUtilization undefined for UNAVAILABLE or missing performanceSummary', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValueOnce({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
      performanceSummary: {
        availability: 'UNAVAILABLE',
        instancesEvaluated: 1,
        instancesWithMetrics: 0,
        instancesIncludedInAverage: 0,
      },
    });
    const unavailableVm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    expect(unavailableVm.averageCpuUtilization).toBeUndefined();

    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValueOnce({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });
    const missingVm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    expect(missingVm.averageCpuUtilization).toBeUndefined();
  });

  it('preserves zero average CPU and rejects non-finite API values', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValueOnce({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
      performanceSummary: {
        availability: 'AVAILABLE',
        averageCpuUtilizationPercent: 0,
        instancesEvaluated: 1,
        instancesWithMetrics: 1,
        instancesIncludedInAverage: 1,
      },
    });
    const zeroVm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    expect(zeroVm.averageCpuUtilization).toBe(0);

    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValueOnce({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
      performanceSummary: {
        availability: 'AVAILABLE',
        averageCpuUtilizationPercent: Number.NaN,
        instancesEvaluated: 1,
        instancesWithMetrics: 1,
        instancesIncludedInAverage: 1,
      },
    });
    const nanVm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    expect(nanVm.averageCpuUtilization).toBeUndefined();
  });
});

describe('Ec2DashboardController provider selection', () => {
  it('uses only the injected provider on retry (no demo fallback)', async () => {
    const failingLive: Ec2DashboardDataProvider = {
      mode: 'live',
      loadDashboard: vi
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({
          ...(await new PublicDemoEc2DashboardDataProvider().loadDashboard({})),
          mode: 'live',
          sourceLabel: 'LIVE AWS DATA',
        }),
    };

    const panels = {
      chrome: document.createElement('div'),
      summary: document.createElement('div'),
      cost: document.createElement('div'),
      instanceMix: document.createElement('div'),
      security: document.createElement('div'),
      rightsizing: document.createElement('div'),
      executive: document.createElement('div'),
    };

    const controller = new Ec2DashboardController({
      provider: failingLive,
      panels,
      getAccessToken: async () => 'token',
      getAccountId: () => '111122223333',
    });

    await controller.load();
    expect(controller.getViewModel()?.dataStatus).toBe('ERROR');
    await controller.retry();
    expect(failingLive.loadDashboard).toHaveBeenCalledTimes(2);
    expect(controller.getProviderMode()).toBe('live');
  });
});

describe('live route source guard', () => {
  it('live dashboard entry does not reference demo data file', () => {
    const mainSource = readFileSync(join(testDir, '../main.ts'), 'utf8');
    expect(mainSource).toContain('LiveEc2DashboardDataProvider');
    expect(mainSource).not.toContain('PublicDemoEc2DashboardDataProvider');
    expect(mainSource).not.toContain('ec2-demo-data');
  });

  it('demo entry does not require authentication or live EC2 APIs', () => {
    const demoSource = readFileSync(join(testDir, '../demo-main.ts'), 'utf8');
    expect(demoSource).toContain('PublicDemoEc2DashboardDataProvider');
    expect(demoSource).toContain('Ec2DemoDashboard');
    expect(demoSource).not.toContain('requireAuthentication');
    expect(demoSource).not.toContain('LiveEc2DashboardDataProvider');
    expect(demoSource).not.toContain('analysis/ec2/start');
    expect(demoSource).not.toContain('Ec2AsyncJobController');
    expect(demoSource).not.toContain('/workflows/run');
    expect(demoSource).not.toContain('/reports/generate');
  });
});

describe('shared widgets from view model', () => {
  it('renders zero instances without Math.max fallback', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 0,
      instancesByState: {},
      instancesByRegion: {},
      instancesByInstanceType: {},
      resourcesByType: {},
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 't',
      accountId: '123456789012',
    });

    const summaryEl = document.createElement('div');
    renderEc2DashboardPanels(
      {
        chrome: document.createElement('div'),
        summary: summaryEl,
        cost: document.createElement('div'),
        instanceMix: document.createElement('div'),
        security: document.createElement('div'),
        rightsizing: document.createElement('div'),
        executive: document.createElement('div'),
      },
      vm,
    );

    expect(summaryEl.textContent).toContain('0');
    expect(summaryEl.textContent).toContain('Not analyzed');
  });

  it('renders finite average CPU from live performance summary mapping', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
      performanceSummary: {
        availability: 'AVAILABLE',
        averageCpuUtilizationPercent: 4.27,
        instancesEvaluated: 1,
        instancesWithMetrics: 1,
        instancesIncludedInAverage: 1,
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    const summaryEl = document.createElement('div');
    renderEc2DashboardPanels(
      {
        chrome: document.createElement('div'),
        summary: summaryEl,
        cost: document.createElement('div'),
        instanceMix: document.createElement('div'),
        security: document.createElement('div'),
        rightsizing: document.createElement('div'),
        executive: document.createElement('div'),
      },
      vm,
    );

    expect(summaryEl.textContent).toContain('Avg CPU4.3%');
  });

  it('renders unavailable live pricing consistently without zero placeholders', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [
        {
          recommendationId: 'rec-burst',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceId: 'i-0ce183611f7fc8ed2',
          category: 'BURSTABLE_CREDIT_PRESSURE',
          severity: 'MEDIUM',
          confidenceLevel: 'MEDIUM',
          title: 'Burstable credit pressure',
          summary: 'T-family credit balance or surplus charges indicate burst pressure.',
          businessJustification: 'Credit exhaustion can throttle performance.',
          recommendedAction: 'Review workload steady-state CPU; consider instance family change after approval.',
          pricingStatus: 'UNAVAILABLE',
          currentInstanceType: 't3.micro',
        },
      ],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    const summary = mapViewModelToEc2Summary(vm);
    expect(summary.monthlyCostUnavailable).toBe(true);
    expect(summary.monthlyCostLabel).toBe('Pricing unavailable');

    const breakdown = mapViewModelToCostBreakdown(vm);
    expect(breakdown.currentMonthlyCostUnavailable).toBe(true);
    expect(breakdown.estimatedSavingsUnavailable).toBe(true);

    const mix = mapViewModelToInstanceMix(vm);
    expect(mix.byFamily[0]?.monthlyCostUnavailable).toBe(true);

    expect(vm.executive.savingsUnavailable).toBe(true);
    expect(vm.cost.sampleEstimateMonthlySavings).toBe(0);

    const panels = {
      chrome: document.createElement('div'),
      summary: document.createElement('div'),
      cost: document.createElement('div'),
      instanceMix: document.createElement('div'),
      security: document.createElement('div'),
      rightsizing: document.createElement('div'),
      executive: document.createElement('div'),
    };
    renderEc2DashboardPanels(panels, vm);

    for (const panel of [panels.summary, panels.cost, panels.instanceMix, panels.executive]) {
      expect(panel.textContent).not.toContain('$0.00');
    }
    expect(panels.summary.textContent).toContain('Pricing unavailable');
    expect(panels.cost.textContent).toContain('Pricing unavailable');
    expect(panels.cost.textContent).toContain('Savings unavailable');
    expect(panels.executive.textContent).toContain('Savings unavailable');
    expect(panels.instanceMix.textContent).toContain('t3');
    expect(panels.instanceMix.textContent).toContain('100%');
    expect(panels.rightsizing.textContent).toContain('Savings unavailable');
  });

  it('renders validated savings when authoritative values exist', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 'm6i.large': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [
        {
          recommendationId: 'rec-downsize',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceId: 'i-downsize-001',
          category: 'REVIEW_DOWNSIZE',
          severity: 'MEDIUM',
          confidenceLevel: 'MEDIUM',
          title: 'Low utilization running instance',
          summary: 'Sustained low CPU may indicate idle capacity.',
          businessJustification: 'Rightsize after review.',
          recommendedAction: 'Review downsizing after approval.',
          pricingStatus: 'VERIFIED_RATE',
          currentInstanceType: 'm6i.large',
          candidateInstanceType: 't3.medium',
          estimatedMonthlySavings: 124.5,
        },
      ],
      savingsSummary: {
        validatedMonthlySavings: 124.5,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(vm.executive.savingsUnavailable).toBe(false);
    expect(vm.executive.savings).toBe(124.5);

    const breakdown = mapViewModelToCostBreakdown(vm);
    expect(breakdown.estimatedSavingsUnavailable).toBe(false);
    expect(breakdown.estimatedSavings).toBe(124.5);

    const executiveEl = document.createElement('div');
    renderEc2DashboardPanels(
      {
        chrome: document.createElement('div'),
        summary: document.createElement('div'),
        cost: document.createElement('div'),
        instanceMix: document.createElement('div'),
        security: document.createElement('div'),
        rightsizing: document.createElement('div'),
        executive: executiveEl,
      },
      vm,
    );

    expect(executiveEl.textContent).toContain('$124.50');
    expect(executiveEl.textContent).not.toContain('Savings unavailable');
  });

  it('renders authoritative zero validated savings when VERIFIED_RATE context exists', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [
        {
          recommendationId: 'rec-verified-zero',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceId: 'i-verified-zero',
          category: 'REVIEW_DOWNSIZE',
          severity: 'LOW',
          confidenceLevel: 'MEDIUM',
          title: 'Already right-sized',
          summary: 'No validated savings remain.',
          businessJustification: 'Verified pricing context with zero savings.',
          recommendedAction: 'No action required.',
          pricingStatus: 'VERIFIED_RATE',
          currentInstanceType: 't3.micro',
          estimatedMonthlySavings: 0,
        },
      ],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        currency: 'USD',
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(vm.executive.savingsUnavailable).toBe(false);
    expect(vm.executive.savings).toBe(0);

    const breakdown = mapViewModelToCostBreakdown(vm);
    expect(breakdown.estimatedSavingsUnavailable).toBe(false);
    expect(breakdown.estimatedSavings).toBe(0);

    const executiveEl = document.createElement('div');
    const costEl = document.createElement('div');
    renderEc2DashboardPanels(
      {
        chrome: document.createElement('div'),
        summary: document.createElement('div'),
        cost: costEl,
        instanceMix: document.createElement('div'),
        security: document.createElement('div'),
        rightsizing: document.createElement('div'),
        executive: executiveEl,
      },
      vm,
    );

    expect(executiveEl.textContent).toContain('$0.00');
    expect(executiveEl.textContent).not.toContain('Savings unavailable');
    expect(costEl.textContent).toContain('$0.00');
    expect(costEl.textContent).not.toContain('Savings unavailable');
  });

  it('does not treat sample-only savingsSummary totals as authoritative in live mode', async () => {
    vi.spyOn(ec2Api, 'fetchEc2ResourceSummary').mockResolvedValue({
      totalResources: 1,
      instancesByState: { running: 1 },
      instancesByRegion: { 'us-east-1': 1 },
      instancesByInstanceType: { 't3.micro': 1 },
      resourcesByType: { INSTANCE: 1 },
      staleResourceCount: 0,
    });
    vi.spyOn(ec2Api, 'fetchEc2CostRecommendations').mockResolvedValue({
      items: [
        {
          recommendationId: 'rec-sample-only',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceId: 'i-sample',
          category: 'INSTANCE_FAMILY_UPGRADE',
          severity: 'LOW',
          confidenceLevel: 'MEDIUM',
          title: 'Review instance family upgrade',
          summary: 'Catalog sample only.',
          businessJustification: 'Sample pricing must not drive live savings widgets.',
          recommendedAction: 'Review migration after approval.',
          pricingStatus: 'CONTROLLED_CATALOG_SAMPLE',
          currentInstanceType: 't2.micro',
          candidateInstanceType: 't3.micro',
        },
      ],
      savingsSummary: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 42,
        currency: 'USD',
      },
    });
    vi.spyOn(ec2Api, 'fetchEc2SecuritySummary').mockRejectedValue(
      new ec2Api.Ec2DashboardApiError('NOT_FOUND', 'Not found', 404),
    );

    const vm = await new LiveEc2DashboardDataProvider().loadDashboard({
      accessToken: 'token',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(vm.executive.savingsUnavailable).toBe(true);
    expect(mapViewModelToCostBreakdown(vm).estimatedSavingsUnavailable).toBe(true);
  });
});

describe('maskAccountId', () => {
  it('masks account id suffix safely', () => {
    expect(maskAccountId('123456789012')).toBe('••••9012');
  });
});

describe('no live-to-demo fallback in live provider source', () => {
  it('does not reference demo provider or demo data', () => {
    const source = readFileSync(
      join(testDir, '../live/live-ec2-dashboard-provider.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/PublicDemoEc2DashboardDataProvider/);
    expect(source).not.toMatch(/ec2-demo-data/);
    expect(source).not.toMatch(/\?\?\s*demo/);
    expect(source).not.toMatch(/Math\.max\s*\(\s*1,/);
  });
});
