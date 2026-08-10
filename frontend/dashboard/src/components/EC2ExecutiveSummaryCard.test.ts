import { describe, it, expect } from 'vitest';
import { renderEc2ExecutiveSummaryCard } from './EC2ExecutiveSummaryCard';

describe('EC2ExecutiveSummaryCard', () => {
  it('labels compliance score and uses not applicable when no instances', () => {
    const container = document.createElement('div');
    renderEc2ExecutiveSummaryCard(container, {
      title: 'No EC2 instances discovered',
      headline: 'Empty account',
      savings: 0,
      securityRisk: 'Analysis complete — no EC2 instances in scope',
      priority: 'Medium',
      confidence: 0,
    });

    expect(container.textContent).toContain('Compliance score');
    expect(container.textContent).toContain('Not applicable (no instances in scope)');
    expect(container.textContent).not.toContain('Not analyzed');
  });
});
