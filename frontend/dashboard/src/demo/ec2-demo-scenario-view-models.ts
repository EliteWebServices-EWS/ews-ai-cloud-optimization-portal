/**
 * Deterministic demo dashboard view models per scenario — no live AWS, no client-side optimization math.
 * Candidate scenarios mirror backend/providers/mock/data (instances, metrics, recommendations).
 */

import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';
import { buildCuratedEc2DemoViewModel } from './ec2-demo-data';
import { getDemoScenarioById } from './ec2-demo-scenarios';

const DEMO_GENERATED_AT = '2026-07-15T12:00:00.000Z';

const SAMPLE_PRICING = {
  status: 'CONTROLLED_CATALOG_SAMPLE' as const,
  label: 'Sample cost estimate — not an AWS bill',
};

function demoReportMeta(scenarioId: string): Ec2DashboardViewModel['reports'] {
  return {
    format: 'json',
    available: true,
    label: 'SAMPLE REPORT',
    watermark: `SAMPLE REPORT — demonstration scenario ${scenarioId}`,
  };
}

function buildMock001ViewModel(): Ec2DashboardViewModel {
  return {
    mode: 'demo',
    dataStatus: 'READY',
    sourceLabel: 'DEMO DATA',
    demoScenarioId: 'i-mock-001',
    demoScenarioLabel: 'web-server-01 · i-mock-001',
    title: 'EC2 Demo — web-server-01',
    subtitle: 'Mock provider scenario i-mock-001 (t3.large) — illustrative only.',
    accountLabel: 'Demo account',
    accountIdSuffix: '••••DEMO',
    region: 'us-east-1',
    generatedAt: DEMO_GENERATED_AT,
    lastDiscoveryAt: DEMO_GENERATED_AT,
    latestCostAnalysisAt: DEMO_GENERATED_AT,
    freshnessStatus: 'Illustrative mock candidate snapshot',
    averageCpuUtilization: 12,
    inventory: {
      totalResources: 1,
      totalInstances: 1,
      runningInstances: 1,
      stoppedInstances: 0,
      instancesByState: { running: 1 },
      instancesByType: { 't3.large': 1 },
      resourcesByType: { INSTANCE: 1 },
    },
    cost: {
      validatedMonthlySavings: 0,
      sampleEstimateMonthlySavings: 30.37,
      estimatedMonthlyCost: 60.74,
      pricingStatus: SAMPLE_PRICING.status,
      pricingLabel: SAMPLE_PRICING.label,
      recommendations: [
        {
          recommendationId: 'demo-mock-001-rec',
          category: 'REVIEW_DOWNSIZE',
          severity: 'MEDIUM',
          confidenceLevel: 'HIGH',
          resourceId: 'i-mock-001',
          title: 'Resize t3.large → t3.medium',
          recommendedAction: 'Rightsize for sustained low CPU (mock recommendation)',
          businessJustification: 'Sustained low CPU utilization over 14 days (mock provider).',
          pricingStatus: SAMPLE_PRICING.status,
          pricingLabel: SAMPLE_PRICING.label,
          estimatedMonthlySavings: 30.37,
          validatedSavings: false,
        },
      ],
      costBreakdown: {
        currentMonthlyCost: 60.74,
        estimatedSavings: 30.37,
        computeCost: 60.74,
        storageCost: 0,
        networkCost: 0,
        otherCost: 0,
        savingsLabel: 'Illustrative savings — not validated',
        showBreakdownDetails: true,
      },
    },
    security: {
      status: 'READY',
      governanceScore: 88,
      complianceScore: 86,
      securityScore: 84,
      riskLevel: 'medium',
      instancesAnalyzed: 1,
      findings: [
        {
          title: 'Legacy security group rule (synthetic)',
          severity: 'Medium',
          count: 1,
          remediation: 'Review ingress for web-server-01 demo instance.',
        },
      ],
    },
    optimization: {
      totalOpportunities: 1,
      idleCandidates: 0,
      downsizeCandidates: 1,
      upsizeCandidates: 0,
      stoppedWithStorage: 0,
      rightsizing: [
        {
          instanceId: 'i-mock-001',
          currentType: 't3.large',
          recommendedType: 't3.medium',
          savings: 30.37,
          utilization: 12,
        },
      ],
    },
    executive: {
      title: 'Underutilized production web tier (demo)',
      headline: 'Mock candidate i-mock-001 shows rightsizing opportunity on low CPU.',
      savings: 30.37,
      securityRisk: '1 synthetic finding · medium risk',
      priority: 'Medium',
      confidence: 86,
    },
    health: { healthy: 1, warning: 0, critical: 0, unknown: 0 },
    warnings: ['Demonstration data for mock provider candidate i-mock-001.'],
    errors: [],
    reports: demoReportMeta('i-mock-001'),
    priorityRecommendations: [
      {
        title: 'Rightsize i-mock-001',
        category: 'cost',
        priority: 'Medium',
        impact: '$30.37/mo (illustrative)',
        detail: 'Resize t3.large to t3.medium per mock Compute Optimizer recommendation.',
      },
    ],
  };
}

function buildMock002ViewModel(): Ec2DashboardViewModel {
  return {
    mode: 'demo',
    dataStatus: 'READY',
    sourceLabel: 'DEMO DATA',
    demoScenarioId: 'i-mock-002',
    demoScenarioLabel: 'dev-api-01 · i-mock-002',
    title: 'EC2 Demo — dev-api-01',
    subtitle: 'Mock provider scenario i-mock-002 (m5.xlarge) — illustrative only.',
    accountLabel: 'Demo account',
    accountIdSuffix: '••••DEMO',
    region: 'us-east-1',
    generatedAt: DEMO_GENERATED_AT,
    lastDiscoveryAt: DEMO_GENERATED_AT,
    latestCostAnalysisAt: DEMO_GENERATED_AT,
    freshnessStatus: 'Illustrative mock candidate snapshot',
    averageCpuUtilization: 8,
    inventory: {
      totalResources: 1,
      totalInstances: 1,
      runningInstances: 1,
      stoppedInstances: 0,
      instancesByState: { running: 1 },
      instancesByType: { 'm5.xlarge': 1 },
      resourcesByType: { INSTANCE: 1 },
    },
    cost: {
      validatedMonthlySavings: 0,
      sampleEstimateMonthlySavings: 70.08,
      estimatedMonthlyCost: 140.16,
      pricingStatus: SAMPLE_PRICING.status,
      pricingLabel: SAMPLE_PRICING.label,
      recommendations: [
        {
          recommendationId: 'demo-mock-002-rec',
          category: 'REVIEW_DOWNSIZE',
          severity: 'HIGH',
          confidenceLevel: 'HIGH',
          resourceId: 'i-mock-002',
          title: 'Resize m5.xlarge → m5.large',
          recommendedAction: 'Downsize overprovisioned development API host (mock)',
          businessJustification: 'Instance oversized for observed workload (mock provider).',
          pricingStatus: SAMPLE_PRICING.status,
          pricingLabel: SAMPLE_PRICING.label,
          estimatedMonthlySavings: 70.08,
          validatedSavings: false,
        },
      ],
    },
    security: {
      status: 'READY',
      governanceScore: 92,
      complianceScore: 90,
      securityScore: 88,
      riskLevel: 'low',
      instancesAnalyzed: 1,
      findings: [],
    },
    optimization: {
      totalOpportunities: 1,
      idleCandidates: 0,
      downsizeCandidates: 1,
      upsizeCandidates: 0,
      stoppedWithStorage: 0,
      rightsizing: [
        {
          instanceId: 'i-mock-002',
          currentType: 'm5.xlarge',
          recommendedType: 'm5.large',
          savings: 70.08,
          utilization: 8,
        },
      ],
    },
    executive: {
      title: 'Overprovisioned development API (demo)',
      headline: 'Mock candidate i-mock-002 — high savings from downsizing m5.xlarge.',
      savings: 70.08,
      securityRisk: 'No synthetic findings on this demo scenario',
      priority: 'High',
      confidence: 90,
    },
    health: { healthy: 1, warning: 0, critical: 0, unknown: 0 },
    warnings: ['Demonstration data for mock provider candidate i-mock-002.'],
    errors: [],
    reports: demoReportMeta('i-mock-002'),
    priorityRecommendations: [
      {
        title: 'Downsize dev-api-01',
        category: 'cost',
        priority: 'High',
        impact: '$70.08/mo (illustrative)',
        detail: 'Resize m5.xlarge to m5.large per mock recommendation.',
      },
    ],
  };
}

function buildMock003ViewModel(): Ec2DashboardViewModel {
  return {
    mode: 'demo',
    dataStatus: 'READY',
    sourceLabel: 'DEMO DATA',
    demoScenarioId: 'i-mock-003',
    demoScenarioLabel: 'staging-worker · i-mock-003',
    title: 'EC2 Demo — staging-worker',
    subtitle: 'Mock provider scenario i-mock-003 (t3.medium) — no mock resize recommendation on file.',
    accountLabel: 'Demo account',
    accountIdSuffix: '••••DEMO',
    region: 'us-east-1',
    generatedAt: DEMO_GENERATED_AT,
    lastDiscoveryAt: DEMO_GENERATED_AT,
    latestCostAnalysisAt: DEMO_GENERATED_AT,
    freshnessStatus: 'Illustrative mock candidate snapshot',
    averageCpuUtilization: 19,
    inventory: {
      totalResources: 1,
      totalInstances: 1,
      runningInstances: 1,
      stoppedInstances: 0,
      instancesByState: { running: 1 },
      instancesByType: { 't3.medium': 1 },
      resourcesByType: { INSTANCE: 1 },
    },
    cost: {
      validatedMonthlySavings: 0,
      sampleEstimateMonthlySavings: 0,
      estimatedMonthlyCost: 30.37,
      pricingStatus: SAMPLE_PRICING.status,
      pricingLabel: SAMPLE_PRICING.label,
      recommendations: [],
    },
    security: {
      status: 'READY',
      governanceScore: 94,
      complianceScore: 93,
      securityScore: 91,
      riskLevel: 'low',
      instancesAnalyzed: 1,
      findings: [],
    },
    optimization: {
      totalOpportunities: 0,
      idleCandidates: 0,
      downsizeCandidates: 0,
      upsizeCandidates: 0,
      stoppedWithStorage: 0,
      rightsizing: [],
    },
    executive: {
      title: 'Staging worker balanced (demo)',
      headline: 'Mock candidate i-mock-003 — moderate utilization; no mock cost recommendation.',
      savings: 0,
      securityRisk: 'No synthetic findings',
      priority: 'Low',
      confidence: 93,
    },
    health: { healthy: 1, warning: 0, critical: 0, unknown: 0 },
    warnings: [
      'Demonstration data for mock provider candidate i-mock-003.',
      'Mock provider has no resize recommendation for this instance.',
    ],
    errors: [],
    reports: demoReportMeta('i-mock-003'),
    priorityRecommendations: [],
  };
}

function buildMock004ViewModel(): Ec2DashboardViewModel {
  return {
    mode: 'demo',
    dataStatus: 'READY',
    sourceLabel: 'DEMO DATA',
    demoScenarioId: 'i-mock-004',
    demoScenarioLabel: 'analytics-batch · i-mock-004',
    title: 'EC2 Demo — analytics-batch',
    subtitle: 'Mock provider scenario i-mock-004 (c5.2xlarge) — illustrative only.',
    accountLabel: 'Demo account',
    accountIdSuffix: '••••DEMO',
    region: 'us-east-1',
    generatedAt: DEMO_GENERATED_AT,
    lastDiscoveryAt: DEMO_GENERATED_AT,
    latestCostAnalysisAt: DEMO_GENERATED_AT,
    freshnessStatus: 'Illustrative mock candidate snapshot',
    averageCpuUtilization: 5,
    inventory: {
      totalResources: 1,
      totalInstances: 1,
      runningInstances: 1,
      stoppedInstances: 0,
      instancesByState: { running: 1 },
      instancesByType: { 'c5.2xlarge': 1 },
      resourcesByType: { INSTANCE: 1 },
    },
    cost: {
      validatedMonthlySavings: 0,
      sampleEstimateMonthlySavings: 124.1,
      estimatedMonthlyCost: 248.2,
      pricingStatus: SAMPLE_PRICING.status,
      pricingLabel: SAMPLE_PRICING.label,
      recommendations: [
        {
          recommendationId: 'demo-mock-004-rec',
          category: 'REVIEW_DOWNSIZE',
          severity: 'HIGH',
          confidenceLevel: 'HIGH',
          resourceId: 'i-mock-004',
          title: 'Resize c5.2xlarge → c5.xlarge',
          recommendedAction: 'Rightsize underutilized analytics batch host (mock)',
          businessJustification: 'Compute instance underutilized (mock provider).',
          pricingStatus: SAMPLE_PRICING.status,
          pricingLabel: SAMPLE_PRICING.label,
          estimatedMonthlySavings: 124.1,
          validatedSavings: false,
        },
      ],
    },
    security: {
      status: 'READY',
      governanceScore: 85,
      complianceScore: 82,
      securityScore: 78,
      riskLevel: 'high',
      instancesAnalyzed: 1,
      findings: [
        {
          title: 'Batch security group exposure (synthetic)',
          severity: 'High',
          count: 2,
          remediation: 'Restrict analytics-batch demo ingress.',
        },
      ],
    },
    optimization: {
      totalOpportunities: 1,
      idleCandidates: 0,
      downsizeCandidates: 1,
      upsizeCandidates: 0,
      stoppedWithStorage: 0,
      rightsizing: [
        {
          instanceId: 'i-mock-004',
          currentType: 'c5.2xlarge',
          recommendedType: 'c5.xlarge',
          savings: 124.1,
          utilization: 5,
        },
      ],
    },
    executive: {
      title: 'Underutilized analytics compute (demo)',
      headline: 'Mock candidate i-mock-004 — largest illustrative savings in mock catalog.',
      savings: 124.1,
      securityRisk: '2 synthetic high findings',
      priority: 'High',
      confidence: 82,
    },
    health: { healthy: 0, warning: 1, critical: 0, unknown: 0 },
    warnings: ['Demonstration data for mock provider candidate i-mock-004.'],
    errors: [],
    reports: demoReportMeta('i-mock-004'),
    priorityRecommendations: [
      {
        title: 'Rightsize analytics-batch',
        category: 'cost',
        priority: 'High',
        impact: '$124.10/mo (illustrative)',
        detail: 'Resize c5.2xlarge to c5.xlarge per mock recommendation.',
      },
      {
        title: 'Review batch security exposure',
        category: 'security',
        priority: 'High',
        impact: '2 synthetic findings',
        detail: 'Illustrative security findings for demo storytelling.',
      },
    ],
  };
}

function buildIllustrativeFleetViewModel(): Ec2DashboardViewModel {
  const base = buildCuratedEc2DemoViewModel();
  return {
    ...base,
    demoScenarioId: 'illustrative-fleet',
    demoScenarioLabel: 'Illustrative multi-instance fleet',
    reports: demoReportMeta('illustrative-fleet'),
  };
}

export function buildDemoScenarioViewModel(scenarioId: string): Ec2DashboardViewModel {
  if (!getDemoScenarioById(scenarioId)) {
    throw new Error(`Unknown demo scenario: ${scenarioId}`);
  }

  switch (scenarioId) {
    case 'i-mock-001':
      return buildMock001ViewModel();
    case 'i-mock-002':
      return buildMock002ViewModel();
    case 'i-mock-003':
      return buildMock003ViewModel();
    case 'i-mock-004':
      return buildMock004ViewModel();
    case 'illustrative-fleet':
      return buildIllustrativeFleetViewModel();
    default:
      throw new Error(`Unknown demo scenario: ${scenarioId}`);
  }
}

export function buildDemoIdleViewModel(): Ec2DashboardViewModel {
  return {
    mode: 'demo',
    dataStatus: 'EMPTY',
    sourceLabel: 'DEMO DATA',
    title: 'EC2 Demonstration Dashboard',
    subtitle: 'Select a demo scenario and click Analyze Demo Environment.',
    accountLabel: 'Demo account',
    accountIdSuffix: '••••DEMO',
    region: 'us-east-1',
    generatedAt: DEMO_GENERATED_AT,
    inventory: {
      totalResources: 0,
      totalInstances: 0,
      runningInstances: 0,
      stoppedInstances: 0,
      instancesByState: {},
      instancesByType: {},
      resourcesByType: {},
    },
    cost: {
      validatedMonthlySavings: 0,
      sampleEstimateMonthlySavings: 0,
      pricingStatus: 'UNAVAILABLE',
      pricingLabel: 'Run demo analysis to view sample estimates',
      recommendations: [],
    },
    security: { status: 'NOT_ANALYZED', findings: [], message: 'Not analyzed — demo scenario not run yet.' },
    optimization: {
      totalOpportunities: 0,
      idleCandidates: 0,
      downsizeCandidates: 0,
      upsizeCandidates: 0,
      stoppedWithStorage: 0,
      rightsizing: [],
    },
    executive: {
      title: 'Ready for demonstration',
      headline: 'Choose a mock scenario from the selector above.',
      savings: 0,
      securityRisk: 'Not analyzed',
      priority: 'Low',
      confidence: 0,
    },
    health: { healthy: 0, warning: 0, critical: 0, unknown: 0 },
    warnings: ['No live AWS account connected.', 'Demonstration mode only.'],
    errors: [],
    reports: { format: 'json', available: false, label: 'SAMPLE REPORT' },
    priorityRecommendations: [],
  };
}
