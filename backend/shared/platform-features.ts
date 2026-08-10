/**
 * Platform feature flags — explicit opt-in for demo-only capabilities.
 */

import { PROVIDER_NAMES } from './constants';
import { AppError } from './utils/errors';

/** Whether workflow-backed demo report generation is allowed (mock provider workflows). */
export function isWorkflowDemoReportsEnabled(): boolean {
  return process.env.WORKFLOW_DEMO_REPORTS_ENABLED === 'true';
}

/** Mock-provider workflows produce demo reports; gate HTTP demo generation when disabled. */
export function isWorkflowDemoReportsGateActive(): boolean {
  const providerMode = (process.env.PROVIDER_MODE ?? PROVIDER_NAMES.MOCK).toLowerCase();
  return providerMode === PROVIDER_NAMES.MOCK;
}

/** Mock-provider workflow report generation via POST /reports/generate is demo-only. */
export function assertWorkflowDemoReportsAllowed(): void {
  if (isWorkflowDemoReportsGateActive() && !isWorkflowDemoReportsEnabled()) {
    throw new AppError(
      'DEMO_REPORTS_DISABLED',
      'Workflow demo report generation is not enabled in this environment.',
      403,
    );
  }
}
