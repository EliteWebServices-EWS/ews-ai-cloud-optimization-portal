import type { Ec2DashboardViewModel } from './ec2-dashboard-view-model';

export interface Ec2DashboardLoadInput {
  accountId?: string;
  region?: string;
  accessToken?: string;
}

export interface Ec2DashboardDataProvider {
  readonly mode: 'demo' | 'live';
  loadDashboard(input: Ec2DashboardLoadInput): Promise<Ec2DashboardViewModel>;
}
