/**
 * SISU'M Decision Dashboard entry point.
 */

import { DecisionDashboard } from './pages/DecisionDashboard';
import './styles/brand-colors.css';
import './styles/dashboard.css';

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el as T;
}

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
  analyzeButton: getRequiredElement<HTMLButtonElement>('analyze-btn'),
  candidateSelect: getRequiredElement<HTMLSelectElement>('candidate-select'),
});

void dashboard.initialize();
