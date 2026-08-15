import { describe, it, expect, beforeEach } from 'vitest';
import { renderOptimizationOverview } from '../components/OptimizationOverview';
import { renderGovernancePanel } from '../components/GovernancePanel';
import { renderFinancialImpactCard } from '../components/FinancialImpactCard';
import { renderEc2SummaryCard } from '../components/EC2SummaryCard';
import { renderEc2CostBreakdownCard } from '../components/EC2CostBreakdownCard';
import { renderEc2InstanceMixCard } from '../components/EC2InstanceMixCard';
import { renderEc2SecurityFindingsCard } from '../components/EC2SecurityFindingsCard';
import { renderEc2RightsizingCard, formatRightsizingSavings, formatRightsizingUtilization } from '../components/EC2RightsizingCard';
import { renderEc2ExecutiveSummaryCard } from '../components/EC2ExecutiveSummaryCard';
import type {
  Ec2CostBreakdown,
  Ec2DashboardSummary,
  Ec2ExecutiveSummary,
  Ec2InstanceMix,
  Ec2RightsizingOpportunity,
  Ec2SecurityFinding,
  FinancialImpact,
  GovernanceResult,
} from '../types';

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

  it('renders EC2 summary card with live inventory status', () => {
    const summary: Ec2DashboardSummary = {
      region: 'us-east-1',
      totalInstances: 42,
      runningInstances: 28,
      stoppedInstances: 14,
      monthlyCost: 2840.25,
      averageCpuUtilization: 52.4,
      rightsizingOpportunities: 7,
      securityFindings: 2,
      governanceScore: 91,
      recommendations: [
        {
          title: 'Rightsize 4 underutilized instances',
          category: 'cost',
          priority: 'High',
          impact: '$420/mo',
          detail: 'Reduce compute spend for low-CPU workloads.'
        }
      ]
    };

    renderEc2SummaryCard(container, summary);
    expect(container.textContent).toContain('EC2 Summary');
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('Running');
    expect(container.textContent).toContain('Rightsize');
  });

  it('renders EC2 cost breakdown with optimization opportunity', () => {
    const cost: Ec2CostBreakdown = {
      currentMonthlyCost: 2840.25,
      estimatedSavings: 420.5,
      computeCost: 1620,
      storageCost: 460,
      networkCost: 230,
      otherCost: 120,
    };

    renderEc2CostBreakdownCard(container, cost);
    expect(container.textContent).toContain('Cost Breakdown');
    expect(container.textContent).toContain('$420.50');
    expect(container.textContent).toContain('Compute');
  });

  it('renders EC2 instance mix by family', () => {
    const mix: Ec2InstanceMix = {
      total: 42,
      byFamily: [
        { family: 'm7i', count: 18, share: 43, monthlyCost: 1100 },
        { family: 'c7i', count: 12, share: 29, monthlyCost: 820 },
      ],
    };

    renderEc2InstanceMixCard(container, mix);
    expect(container.textContent).toContain('Instance Mix');
    expect(container.textContent).toContain('m7i');
    expect(container.textContent).toContain('43%');
  });

  it('renders EC2 security findings with action intensity', () => {
    const findings: Ec2SecurityFinding[] = [
      {
        title: 'Public ingress on sg-017',
        severity: 'High',
        count: 2,
        remediation: 'Restrict to corporate CIDR ranges.',
      },
    ];

    renderEc2SecurityFindingsCard(container, findings);
    expect(container.textContent).toContain('Security Findings');
    expect(container.textContent).toContain('High');
    expect(container.textContent).toContain('sg-017');
  });

  it('renders EC2 rightsizing opportunities', () => {
    const opportunities: Ec2RightsizingOpportunity[] = [
      {
        instanceId: 'i-123456',
        currentType: 'm6i.large',
        recommendedType: 't3.medium',
        savings: 124.5,
        utilization: 18,
      },
    ];

    renderEc2RightsizingCard(container, opportunities);
    expect(container.textContent).toContain('Rightsizing');
    expect(container.textContent).toContain('i-123456');
    expect(container.textContent).toContain('m6i.large');
    expect(container.textContent).toContain('18% utilization');
    expect(container.textContent).toContain('$124.50/mo');
  });

  it('renders safe rightsizing wording for missing or non-finite metrics', () => {
    const opportunities: Ec2RightsizingOpportunity[] = [
      {
        instanceId: 'i-missing-metrics',
        currentType: 't3.micro',
        recommendedType: 'Review workload steady-state CPU; consider instance family change after approval.',
      },
      {
        instanceId: 'i-nan-metrics',
        currentType: 'm5.large',
        recommendedType: 't3.medium',
        utilization: Number.NaN,
        savings: Number.NaN,
      },
      {
        instanceId: 'i-infinite-metrics',
        currentType: 'c5.xlarge',
        recommendedType: 'c5.large',
        utilization: Number.POSITIVE_INFINITY,
        savings: Number.NEGATIVE_INFINITY,
      },
      {
        instanceId: 'i-zero-metrics',
        currentType: 't3.small',
        recommendedType: 't3.micro',
        utilization: 0,
        savings: 0,
      },
    ];

    renderEc2RightsizingCard(container, opportunities);
    const text = container.textContent ?? '';

    expect(text).toContain('Utilization not analyzed');
    expect(text).toContain('Savings unavailable');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
    expect(text).toContain('0% utilization');
    expect(text).toContain('$0.00/mo');
    expect(text).toContain('Review workload steady-state CPU');
  });

  it('formats rightsizing utilization and savings helpers safely', () => {
    expect(formatRightsizingUtilization(undefined)).toBe('Utilization not analyzed');
    expect(formatRightsizingUtilization(Number.NaN)).toBe('Utilization not analyzed');
    expect(formatRightsizingUtilization(Number.POSITIVE_INFINITY)).toBe('Utilization not analyzed');
    expect(formatRightsizingUtilization(12.4)).toBe('12.4% utilization');
    expect(formatRightsizingUtilization(0)).toBe('0% utilization');

    expect(formatRightsizingSavings(undefined)).toBe('Savings unavailable');
    expect(formatRightsizingSavings(Number.NaN)).toBe('Savings unavailable');
    expect(formatRightsizingSavings(Number.POSITIVE_INFINITY)).toBe('Savings unavailable');
    expect(formatRightsizingSavings(42.5)).toBe('$42.50/mo');
    expect(formatRightsizingSavings(0)).toBe('$0.00/mo');
  });

  it('renders EC2 executive summary with savings and priority message', () => {
    const executive: Ec2ExecutiveSummary = {
      title: 'EC2 optimization opportunity',
      headline: 'Improve cost and risk posture across the production fleet',
      savings: 541.2,
      securityRisk: '2 high-priority findings remain',
      priority: 'High',
      confidence: 92,
    };

    renderEc2ExecutiveSummaryCard(container, executive);
    expect(container.textContent).toContain('Executive Summary');
    expect(container.textContent).toContain('$541.20');
    expect(container.textContent).toContain('High');
  });

  it('renders empty state when governance is undefined', () => {
    renderGovernancePanel(container, undefined);
    expect(container.textContent).toContain('Governance evaluation pending');
  });
});
