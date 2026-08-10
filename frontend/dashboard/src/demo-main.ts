/**
 * Public EC2 demo dashboard — curated mock scenarios only, no authentication.
 */

import { Ec2DashboardController } from './pages/Ec2DashboardController';
import { PublicDemoEc2DashboardDataProvider } from './demo/public-demo-ec2-dashboard-provider';
import { Ec2DemoDashboard } from './demo/ec2-demo-dashboard';
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
const panels = {
  chrome: getRequiredElement('ec2-dashboard-chrome'),
  statusBanner: getRequiredElement('ec2-status-banner'),
  summary: getRequiredElement('ec2-summary-panel'),
  cost: getRequiredElement('ec2-cost-panel'),
  instanceMix: getRequiredElement('ec2-mix-panel'),
  security: getRequiredElement('ec2-security-panel'),
  rightsizing: getRequiredElement('ec2-rightsizing-panel'),
  executive: getRequiredElement('ec2-executive-panel'),
};

const decision = {
  workflowProgress: getRequiredElement('demo-workflow-progress-panel'),
  learningOutcome: getRequiredElement('demo-learning-outcome-panel'),
  candidate: getRequiredElement('demo-candidate-panel'),
  evidence: getRequiredElement('demo-evidence-panel'),
  governance: getRequiredElement('demo-governance-panel'),
  financial: getRequiredElement('demo-financial-panel'),
  confidence: getRequiredElement('demo-confidence-panel'),
  recommendation: getRequiredElement('demo-recommendation-panel'),
  verification: getRequiredElement('demo-verification-panel'),
  reportPreview: getRequiredElement('demo-report-preview-panel'),
};

const ec2Controller = new Ec2DashboardController({ provider, panels });

const viewDemoReportLinkEl = document.getElementById('view-demo-report-link');

const demoDashboard = new Ec2DemoDashboard(
  {
    scenarioSelect: getRequiredElement<HTMLSelectElement>('demo-scenario-select'),
    analyzeButton: getRequiredElement<HTMLButtonElement>('analyze-demo-btn'),
    stateMessage: getRequiredElement('demo-state-message'),
    exportButton: getRequiredElement<HTMLButtonElement>('ec2-export-json-btn'),
    viewDemoReportLink:
      viewDemoReportLinkEl instanceof HTMLAnchorElement ? viewDemoReportLinkEl : undefined,
    panels,
    decision,
  },
  ec2Controller,
);

getRequiredElement<HTMLButtonElement>('ec2-export-json-btn').addEventListener('click', () => {
  demoDashboard.exportSampleJson();
});

export { demoDashboard, ec2Controller };
