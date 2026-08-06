/**
 * Curated synthetic EC2 demo dashboard data — public demonstration only.
 * No real tenant, account, or AWS resource identifiers.
 */

import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';

const GENERATED_AT = '2026-07-15T12:00:00.000Z';

export function buildCuratedEc2DemoViewModel(): Ec2DashboardViewModel {
  return {
    mode: 'demo',
    dataStatus: 'READY',
    sourceLabel: 'DEMO DATA',
    title: 'EC2 Optimization Demo',
    subtitle: 'Illustrative EC2 environment — not connected to a live AWS account.',
    accountLabel: 'Demo account',
    accountIdSuffix: '••••DEMO',
    region: 'us-east-1',
    generatedAt: GENERATED_AT,
    lastDiscoveryAt: GENERATED_AT,
    latestCostAnalysisAt: GENERATED_AT,
    freshnessStatus: 'Illustrative snapshot',
    inventory: {
      totalResources: 44,
      totalInstances: 42,
      runningInstances: 28,
      stoppedInstances: 14,
      instancesByState: { running: 28, stopped: 14 },
      instancesByType: { 'm7i.large': 18, 'c7i.xlarge': 12, 't3.medium': 12 },
      resourcesByType: { INSTANCE: 42, NETWORK_INTERFACE: 2 },
    },
    cost: {
      validatedMonthlySavings: 0,
      sampleEstimateMonthlySavings: 420.5,
      estimatedMonthlyCost: 2840.25,
      pricingStatus: 'CONTROLLED_CATALOG_SAMPLE',
      pricingLabel: 'Sample cost estimate — not an AWS bill',
      recommendations: [
        {
          recommendationId: 'demo-rec-001',
          category: 'REVIEW_DOWNSIZE',
          severity: 'HIGH',
          confidenceLevel: 'HIGH',
          resourceId: 'i-demo-ec2-001',
          title: 'Rightsize underutilized instances',
          recommendedAction: 'Review instance size for low CPU workloads',
          businessJustification: 'Illustrative savings from rightsizing demo workloads.',
          pricingStatus: 'CONTROLLED_CATALOG_SAMPLE',
          pricingLabel: 'Sample cost estimate — not an AWS bill',
          estimatedMonthlySavings: 420.5,
          validatedSavings: false,
        },
      ],
      costBreakdown: {
        currentMonthlyCost: 2840.25,
        estimatedSavings: 420.5,
        computeCost: 1618.94,
        storageCost: 454.44,
        networkCost: 255.62,
        otherCost: 511.25,
        savingsLabel: 'Illustrative savings — not validated',
        showBreakdownDetails: true,
      },
    },
    security: {
      status: 'READY',
      governanceScore: 91,
      findings: [
        {
          title: 'Public ingress on sg-demo-017 (synthetic)',
          severity: 'High',
          count: 2,
          remediation: 'Restrict to corporate CIDR ranges.',
        },
        {
          title: 'SSH open to 0.0.0.0/0 (synthetic)',
          severity: 'Critical',
          count: 1,
          remediation: 'Disable direct internet SSH access.',
        },
      ],
    },
    optimization: {
      totalOpportunities: 3,
      idleCandidates: 1,
      downsizeCandidates: 2,
      upsizeCandidates: 0,
      stoppedWithStorage: 0,
      rightsizing: [
        {
          instanceId: 'i-demo-ec2-001',
          currentType: 'm6i.large',
          recommendedType: 't3.medium',
          savings: 124.5,
          utilization: 18,
        },
        {
          instanceId: 'i-demo-ec2-002',
          currentType: 'c6i.xlarge',
          recommendedType: 'c6i.large',
          savings: 96.2,
          utilization: 22,
        },
      ],
    },
    executive: {
      title: 'EC2 optimization opportunity (demo)',
      headline: 'Improve cost and risk posture across an illustrative EC2 fleet.',
      savings: 541.2,
      securityRisk: '2 active security findings (synthetic)',
      priority: 'High',
      confidence: 92,
    },
    health: { healthy: 26, warning: 12, critical: 2, unknown: 2 },
    averageCpuUtilization: 52.4,
    warnings: ['All values are curated demonstration data.'],
    errors: [],
    reports: {
      format: 'json',
      available: true,
      label: 'SAMPLE REPORT',
      watermark: 'SAMPLE REPORT — demonstration data only',
    },
    priorityRecommendations: [
      {
        title: 'Rightsize 4 underutilized instances',
        category: 'cost',
        priority: 'High',
        impact: '$420/mo (illustrative)',
        detail: 'Reduce compute spend for low-CPU workloads.',
      },
      {
        title: 'Review security exposure findings',
        category: 'security',
        priority: 'High',
        impact: '2 active findings (synthetic)',
        detail: 'Restrict public access and verify EC2 security posture.',
      },
    ],
  };
}
