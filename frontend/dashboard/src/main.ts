/**
 * SISU'M Decision Dashboard entry point.
 */

import { DecisionDashboard } from './pages/DecisionDashboard';
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

async function initializeDashboard(): Promise<void> {
  await requireAuthentication();

  document.documentElement.classList.remove('auth-checking');
  document.documentElement.classList.add('authenticated');

  displayAuthenticatedUser();
  attachLogoutButton();

  const dashboard = new DecisionDashboard({
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
    analyzeButton:
      getRequiredElement<HTMLButtonElement>('analyze-btn'),
    candidateSelect:
      getRequiredElement<HTMLSelectElement>('candidate-select'),
  });

  await dashboard.initialize();
}

void initializeDashboard().catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message === 'Redirecting to sign-in.'
  ) {
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