/**
 * Public EC2 demo dashboard — curated data only, no authentication.
 */

import { Ec2DashboardController } from './pages/Ec2DashboardController';
import { PublicDemoEc2DashboardDataProvider } from './demo/public-demo-ec2-dashboard-provider';
import './styles/brand-colors.css';
import './styles/dashboard.css';

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element #${id} not found`);
  }
  return element as T;
}

const provider = new PublicDemoEc2DashboardDataProvider();
const controller = new Ec2DashboardController({
  provider,
  panels: {
    chrome: getRequiredElement('ec2-dashboard-chrome'),
    statusBanner: getRequiredElement('ec2-status-banner'),
    summary: getRequiredElement('ec2-summary-panel'),
    cost: getRequiredElement('ec2-cost-panel'),
    instanceMix: getRequiredElement('ec2-mix-panel'),
    security: getRequiredElement('ec2-security-panel'),
    rightsizing: getRequiredElement('ec2-rightsizing-panel'),
    executive: getRequiredElement('ec2-executive-panel'),
  },
});

const exportButton = document.getElementById('ec2-export-json-btn');
exportButton?.addEventListener('click', () => {
  const json = controller.exportJsonReport();
  if (!json) {
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ec2-sample-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
});

void controller.load();
