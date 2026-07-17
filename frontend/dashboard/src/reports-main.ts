/**
 * SISU'M Reports Page entry point.
 */

import { ReportsPage } from './pages/ReportsPage';
import { requireAuthentication } from './auth/guard';
import { attachLogoutButton } from './auth/logout';
import { getUserEmail, getUserGroups } from './auth/session';
import './styles/brand-colors.css';
import './styles/dashboard.css';

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Required element #${id} not found`);
  }

  return element as T;
}

function displayAuthenticatedUser(): void {
  const userElement = document.getElementById('authenticated-user');

  if (!userElement) {
    return;
  }

  const email = getUserEmail() ?? 'Authenticated user';
  const roles = getUserGroups();

  userElement.textContent =
    roles.length > 0
      ? `${email} · ${roles.join(', ')}`
      : email;
}

async function initializeReports(): Promise<void> {
  await requireAuthentication();

  displayAuthenticatedUser();
  attachLogoutButton();

  const page = new ReportsPage({
    stateMessage: getRequiredElement('state-message'),
    filtersForm:
      getRequiredElement<HTMLFormElement>('report-filters'),
    reportList: getRequiredElement('report-list-panel'),
    reportDetail: getRequiredElement('report-detail-panel'),
    summaryPanel: getRequiredElement('summary-panel'),
    savingsPanel: getRequiredElement('savings-panel'),
    recommendationPanel:
      getRequiredElement('recommendation-panel'),
    verificationPanel:
      getRequiredElement('verification-panel'),
    generateButton:
      getRequiredElement<HTMLButtonElement>(
        'generate-report-btn'
      ),
    refreshButton:
      getRequiredElement<HTMLButtonElement>(
        'refresh-reports-btn'
      ),
  });

  await page.initialize();
}

void initializeReports().catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message !== 'Redirecting to sign-in.'
  ) {
    console.error('Reports initialization failed:', error);
  }
});
