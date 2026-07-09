/**
 * SISU'M Reports Page entry point.
 */

import { ReportsPage } from './pages/ReportsPage';
import './styles/brand-colors.css';
import './styles/dashboard.css';

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el as T;
}

const page = new ReportsPage({
  stateMessage: getRequiredElement('state-message'),
  filtersForm: getRequiredElement<HTMLFormElement>('report-filters'),
  reportList: getRequiredElement('report-list-panel'),
  reportDetail: getRequiredElement('report-detail-panel'),
  summaryPanel: getRequiredElement('summary-panel'),
  savingsPanel: getRequiredElement('savings-panel'),
  recommendationPanel: getRequiredElement('recommendation-panel'),
  verificationPanel: getRequiredElement('verification-panel'),
  generateButton: getRequiredElement<HTMLButtonElement>('generate-report-btn'),
  refreshButton: getRequiredElement<HTMLButtonElement>('refresh-reports-btn'),
});

void page.initialize();
