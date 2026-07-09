import { describe, it, expect, beforeEach } from 'vitest';
import { renderOptimizationOverview } from '../components/OptimizationOverview';
import { renderGovernancePanel } from '../components/GovernancePanel';
import { renderFinancialImpactCard } from '../components/FinancialImpactCard';
import type { FinancialImpact, GovernanceResult } from '../types';

describe('Dashboard components', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renders OptimizationOverview with backend metrics', () => {
    renderOptimizationOverview(container, {
      totalCandidates: 4,
      readyCandidates: 1,
      potentialMonthlySavings: 26.6,
      averageConfidence: 94,
    });

    expect(container.textContent).toContain('Total Candidates');
    expect(container.textContent).toContain('4');
    expect(container.textContent).toContain('94%');
  });

  it('renders GovernancePanel with policy results', () => {
    const governance: GovernanceResult = {
      status: 'READY',
      decision: 'approved',
      readinessScore: 92,
      readiness: { score: 92, status: 'READY', factors: [] },
      reason: 'Development workload eligible',
      policies: [
        { name: 'Environment Policy', status: 'PASS', reason: 'Dev environment', severity: 'LOW' },
      ],
    };

    renderGovernancePanel(container, governance);
    expect(container.textContent).toContain('92% readiness');
    expect(container.textContent).toContain('Environment Policy');
  });

  it('renders FinancialImpactCard without client-side calculations', () => {
    const financial: FinancialImpact = {
      currentMonthlyCost: 85.2,
      projectedMonthlyCost: 58.6,
      monthlySavings: 26.6,
      annualSavings: 319.2,
      percentageReduction: 31.2,
      status: 'ESTIMATED',
      currency: 'USD',
    };

    renderFinancialImpactCard(container, financial);
    expect(container.textContent).toContain('Monthly Savings');
    expect(container.textContent).toContain('26.60');
  });

  it('renders empty state when governance is undefined', () => {
    renderGovernancePanel(container, undefined);
    expect(container.textContent).toContain('Governance evaluation pending');
  });
});
