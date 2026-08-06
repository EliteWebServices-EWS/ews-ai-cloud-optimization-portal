import type { Ec2DashboardDataProvider, Ec2DashboardLoadInput } from '../ec2/ec2-dashboard-provider';
import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';
import { buildCuratedEc2DemoViewModel } from './ec2-demo-data';

/**
 * Public demo provider — no network, tokens, or tenant APIs.
 */
export class PublicDemoEc2DashboardDataProvider implements Ec2DashboardDataProvider {
  readonly mode = 'demo' as const;

  async loadDashboard(_input: Ec2DashboardLoadInput): Promise<Ec2DashboardViewModel> {
    return buildCuratedEc2DemoViewModel();
  }
}
