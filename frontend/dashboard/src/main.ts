/**
 * SISU'M Decision Dashboard entry point — authenticated live EC2 + workflow analysis.
 */

import { Ec2AsyncJobController } from './ec2-async-job/Ec2AsyncJobController';
import { DecisionDashboard } from './pages/DecisionDashboard';
import { Ec2DashboardController } from './pages/Ec2DashboardController';
import { requireAuthentication, getOrRefreshAccessToken } from './auth/guard';
import { attachLogoutButton } from './auth/logout';
import { getUserEmail, getUserGroups } from './auth/session';
import { LiveEc2DashboardDataProvider } from './live/live-ec2-dashboard-provider';
import { listTenantAwsAccounts } from './live/ec2-dashboard-api';
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
    roles.length > 0 ? `${email} · ${roles.join(', ')}` : email;
}

async function initializeDashboard(): Promise<void> {
  await requireAuthentication();

  document.documentElement.classList.remove('auth-checking');
  document.documentElement.classList.add('authenticated');

  displayAuthenticatedUser();
  attachLogoutButton();

  let selectedAccountId: string | undefined;
  const accountSelect = document.getElementById('ec2-account-select') as HTMLSelectElement | null;
  const regionSelect = document.getElementById('ec2-region-select') as HTMLSelectElement | null;
  const retryButton = document.getElementById('ec2-retry-btn') as HTMLButtonElement | null;
  const exportButton = document.getElementById('ec2-export-json-btn') as HTMLButtonElement | null;

  const liveProvider = new LiveEc2DashboardDataProvider();
  const ec2Controller = new Ec2DashboardController({
    provider: liveProvider,
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
    getAccessToken: () => getOrRefreshAccessToken(),
    getAccountId: () => selectedAccountId ?? accountSelect?.value ?? undefined,
    getRegion: () => regionSelect?.value ?? 'us-east-1',
  });

  retryButton?.addEventListener('click', () => {
    void ec2Controller.retry();
  });

  exportButton?.addEventListener('click', () => {
    const json = ec2Controller.exportJsonReport();
    if (!json) {
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ec2-decision-report.json';
    anchor.click();
    URL.revokeObjectURL(url);
  });

  if (accountSelect) {
    try {
      const token = await getOrRefreshAccessToken();
      if (token) {
        const accounts = await listTenantAwsAccounts(token);
        accountSelect.innerHTML = '';
        for (const account of accounts.accounts) {
          const option = document.createElement('option');
          option.value = account.accountId;
          option.textContent = account.displayName
            ? `${account.displayName} (••••${account.accountId.slice(-4)})`
            : `Account ••••${account.accountId.slice(-4)}`;
          accountSelect.appendChild(option);
        }
        selectedAccountId = accounts.accounts[0]?.accountId;
      }
    } catch {
      accountSelect.innerHTML = '<option value="">Connect an AWS account</option>';
    }
    accountSelect.addEventListener('change', () => {
      selectedAccountId = accountSelect.value || undefined;
      void ec2Controller.load();
    });
  }

  regionSelect?.addEventListener('change', () => {
    void ec2Controller.load();
  });

  const asyncJobController = new Ec2AsyncJobController({
    progressPanel: getRequiredElement('progress-panel'),
    historyPanel: getRequiredElement('job-history-panel'),
    getAccountId: () => selectedAccountId ?? accountSelect?.value ?? undefined,
    getRegions: () => {
      const region = regionSelect?.value ?? 'us-east-1';
      return region ? [region] : [];
    },
    ec2Dashboard: ec2Controller,
  });

  const dashboard = new DecisionDashboard(
    {
      stateMessage: getRequiredElement('state-message'),
      overview: getRequiredElement('overview-panel'),
      progress: getRequiredElement('progress-panel'),
      candidate: getRequiredElement('candidate-panel'),
      evidence: getRequiredElement('evidence-panel'),
      governance: getRequiredElement('governance-panel'),
      financial: getRequiredElement('financial-panel'),
      confidence: getRequiredElement('confidence-panel'),
      recommendation: getRequiredElement('recommendation-panel'),
      verification: getRequiredElement('verification-panel'),
      analyzeButton: getRequiredElement<HTMLButtonElement>('analyze-btn'),
      candidateSelect: getRequiredElement<HTMLSelectElement>('candidate-select'),
    },
    ec2Controller,
    asyncJobController,
  );

  window.addEventListener('beforeunload', () => {
    asyncJobController.destroy();
  });

  await dashboard.initialize();
}

void initializeDashboard().catch((error: unknown) => {
  if (error instanceof Error && error.message === 'Redirecting to sign-in.') {
    return;
  }

  console.error('Dashboard initialization failed:', error);

  document.body.innerHTML = `
    <main role="alert" style="padding:2rem;color:#ffffff;background:#0A0A0A;">
      <h1>Unable to verify your session</h1>
      <p>Please refresh the page or try signing in again.</p>
    </main>
  `;

  document.documentElement.classList.remove('auth-checking');
  document.documentElement.classList.add('authenticated');
});
