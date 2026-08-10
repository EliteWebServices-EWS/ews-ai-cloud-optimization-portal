/**
 * Public Demo Reports — no authentication, no Reporting Engine API calls.
 */

import { DemoReportsPage } from './demo/DemoReportsPage';
import './styles/brand-colors.css';
import './styles/dashboard.css';

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element #${id} not found`);
  }
  return element as T;
}

const page = new DemoReportsPage({
  stateMessage: getRequiredElement('demo-reports-state-message'),
  reportList: getRequiredElement('demo-reports-list'),
  reportBody: getRequiredElement('demo-reports-body'),
  verificationPanel: getRequiredElement('demo-reports-verification'),
  reportMeta: getRequiredElement('demo-reports-meta'),
  exportButton: getRequiredElement<HTMLButtonElement>('demo-reports-export-json-btn'),
});

page.initializeFromLocation(window.location.search);

export { page };
