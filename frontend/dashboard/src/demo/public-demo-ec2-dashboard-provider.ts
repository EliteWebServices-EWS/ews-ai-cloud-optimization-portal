import type { Ec2DashboardDataProvider, Ec2DashboardLoadInput } from '../ec2/ec2-dashboard-provider';
import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';
import { buildDemoScenarioViewModel } from './ec2-demo-scenario-view-models';
import { attachDemoDecisionIntelligence } from './ec2-demo-decision-builders';
import { DEFAULT_DEMO_SCENARIO_ID } from './ec2-demo-scenarios';

/**
 * Public demo provider — no network, tokens, tenant APIs, or live EC2 async jobs.
 */
export class PublicDemoEc2DashboardDataProvider implements Ec2DashboardDataProvider {
  readonly mode = 'demo' as const;

  async loadDashboard(input: Ec2DashboardLoadInput): Promise<Ec2DashboardViewModel> {
    const scenarioId = input.demoScenarioId ?? DEFAULT_DEMO_SCENARIO_ID;
    return attachDemoDecisionIntelligence(buildDemoScenarioViewModel(scenarioId));
  }
}
