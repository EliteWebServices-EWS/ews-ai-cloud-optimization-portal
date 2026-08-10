import type { Ec2DashboardDataProvider } from '../ec2/ec2-dashboard-provider';
import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';
import {
  buildEc2JsonReport,
  renderEc2DashboardPanels,
  type Ec2DashboardPanelElements,
} from '../ec2/render-ec2-dashboard';

export interface Ec2DashboardControllerOptions {
  provider: Ec2DashboardDataProvider;
  panels: Ec2DashboardPanelElements;
  getAccessToken?: () => Promise<string | null>;
  getAccountId?: () => string | undefined;
  getRegion?: () => string | undefined;
  onSessionExpired?: () => void;
}

export class Ec2DashboardController {
  private viewModel: Ec2DashboardViewModel | null = null;

  constructor(private readonly options: Ec2DashboardControllerOptions) {}

  getViewModel(): Ec2DashboardViewModel | null {
    return this.viewModel;
  }

  getProviderMode(): 'demo' | 'live' {
    return this.options.provider.mode;
  }

  async load(): Promise<void> {
    this.viewModel = {
      mode: this.options.provider.mode,
      dataStatus: 'LOADING',
      sourceLabel: this.options.provider.mode === 'demo' ? 'DEMO DATA' : 'LIVE AWS DATA',
      title: 'EC2 Dashboard',
      subtitle: 'Loading…',
      region: this.options.getRegion?.() ?? 'us-east-1',
      generatedAt: new Date().toISOString(),
      inventory: {
        totalResources: 0,
        totalInstances: 0,
        runningInstances: 0,
        stoppedInstances: 0,
        instancesByState: {},
        instancesByType: {},
        resourcesByType: {},
      },
      cost: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        pricingStatus: 'UNAVAILABLE',
        pricingLabel: 'Pricing unavailable',
        recommendations: [],
      },
      security: { status: 'UNAVAILABLE', findings: [] },
      optimization: {
        totalOpportunities: 0,
        idleCandidates: 0,
        downsizeCandidates: 0,
        upsizeCandidates: 0,
        stoppedWithStorage: 0,
        rightsizing: [],
      },
      executive: {
        title: 'Loading',
        headline: '',
        savings: 0,
        securityRisk: '',
        priority: 'Medium',
        confidence: 0,
      },
      health: { healthy: 0, warning: 0, critical: 0, unknown: 0 },
      warnings: [],
      errors: [],
      reports: { format: 'json', available: false, label: 'Report' },
      priorityRecommendations: [],
    };
    renderEc2DashboardPanels(this.options.panels, this.viewModel);

    const accessToken =
      this.options.provider.mode === 'live'
        ? (await this.options.getAccessToken?.()) ?? undefined
        : undefined;

    if (this.options.provider.mode === 'live' && !accessToken) {
      this.viewModel = {
        ...this.viewModel,
        dataStatus: 'ERROR',
        errors: ['Sign in to view live EC2 data.'],
        subtitle: 'Authentication required.',
      };
      renderEc2DashboardPanels(this.options.panels, this.viewModel);
      return;
    }

    try {
      this.viewModel = await this.options.provider.loadDashboard({
        accountId: this.options.getAccountId?.(),
        region: this.options.getRegion?.(),
        accessToken,
      });
    } catch {
      this.viewModel = {
        ...this.viewModel,
        dataStatus: 'ERROR',
        errors: ['Unable to load EC2 dashboard. Retry or sign in again.'],
      };
    }

    renderEc2DashboardPanels(this.options.panels, this.viewModel);
  }

  async retry(): Promise<void> {
    await this.load();
  }

  async loadDemoScenario(demoScenarioId: string): Promise<void> {
    if (this.options.provider.mode !== 'demo') {
      throw new Error('loadDemoScenario is only available in demo mode');
    }

    this.viewModel = {
      mode: 'demo',
      dataStatus: 'LOADING',
      sourceLabel: 'DEMO DATA',
      title: 'EC2 Demo',
      subtitle: 'Analyzing demo scenario…',
      region: 'us-east-1',
      generatedAt: new Date().toISOString(),
      inventory: {
        totalResources: 0,
        totalInstances: 0,
        runningInstances: 0,
        stoppedInstances: 0,
        instancesByState: {},
        instancesByType: {},
        resourcesByType: {},
      },
      cost: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        pricingStatus: 'UNAVAILABLE',
        pricingLabel: 'Loading…',
        recommendations: [],
      },
      security: { status: 'NOT_ANALYZED', findings: [] },
      optimization: {
        totalOpportunities: 0,
        idleCandidates: 0,
        downsizeCandidates: 0,
        upsizeCandidates: 0,
        stoppedWithStorage: 0,
        rightsizing: [],
      },
      executive: {
        title: 'Analyzing',
        headline: '',
        savings: 0,
        securityRisk: '',
        priority: 'Medium',
        confidence: 0,
      },
      health: { healthy: 0, warning: 0, critical: 0, unknown: 0 },
      warnings: [],
      errors: [],
      reports: { format: 'json', available: false, label: 'SAMPLE REPORT' },
      priorityRecommendations: [],
      demoScenarioId,
    };
    renderEc2DashboardPanels(this.options.panels, this.viewModel);

    this.viewModel = await this.options.provider.loadDashboard({ demoScenarioId });
    renderEc2DashboardPanels(this.options.panels, this.viewModel);
  }

  exportJsonReport(): string | null {
    if (!this.viewModel || this.viewModel.dataStatus === 'ERROR') {
      return null;
    }
    return buildEc2JsonReport(this.viewModel);
  }
}
