/**
 * Normalized EC2 dashboard view model — sole input for shared EC2 widgets.
 */

import type {
  Ec2CostBreakdown,
  Ec2DashboardSummary,
  Ec2ExecutiveSummary,
  Ec2InstanceMix,
  Ec2RecommendationItem,
  Ec2RightsizingOpportunity,
  Ec2SecurityFinding,
} from '../types';

export type DashboardDataMode = 'demo' | 'live';

export type Ec2DashboardDataStatus =
  | 'READY'
  | 'LOADING'
  | 'EMPTY'
  | 'PARTIAL'
  | 'STALE'
  | 'ERROR'
  | 'UNAVAILABLE';

export type Ec2SecuritySectionStatus = 'READY' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_ANALYZED';

export interface Ec2DashboardCostRecommendationView {
  recommendationId: string;
  category: string;
  severity: string;
  confidenceLevel: string;
  resourceId: string;
  title: string;
  recommendedAction: string;
  businessJustification: string;
  pricingStatus: string;
  pricingLabel: string;
  estimatedMonthlySavings?: number;
  validatedSavings: boolean;
}

export interface Ec2DashboardInventoryView {
  totalResources: number;
  totalInstances: number;
  runningInstances: number;
  stoppedInstances: number;
  instancesByState: Record<string, number>;
  instancesByType: Record<string, number>;
  resourcesByType: Record<string, number>;
}

export interface Ec2DashboardCostView {
  validatedMonthlySavings: number;
  sampleEstimateMonthlySavings: number;
  estimatedMonthlyCost?: number;
  pricingStatus: string;
  pricingLabel: string;
  recommendations: Ec2DashboardCostRecommendationView[];
  costBreakdown?: Ec2CostBreakdown;
}

export interface Ec2DashboardSecurityView {
  status: Ec2SecuritySectionStatus;
  securityScore?: number;
  governanceScore?: number;
  complianceScore?: number;
  riskLevel?: string;
  findings: Ec2SecurityFinding[];
  message?: string;
}

export interface Ec2DashboardOptimizationView {
  totalOpportunities: number;
  idleCandidates: number;
  downsizeCandidates: number;
  upsizeCandidates: number;
  stoppedWithStorage: number;
  rightsizing: Ec2RightsizingOpportunity[];
}

export interface Ec2DashboardHealthView {
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
}

export interface Ec2DashboardReportView {
  format: 'json';
  available: boolean;
  label: string;
  watermark?: string;
}

export interface Ec2DashboardViewModel {
  mode: DashboardDataMode;
  dataStatus: Ec2DashboardDataStatus;
  sourceLabel: string;
  title: string;
  subtitle: string;
  accountLabel?: string;
  accountIdSuffix?: string;
  region: string;
  generatedAt: string;
  lastDiscoveryAt?: string;
  latestCostAnalysisAt?: string;
  latestSecurityAnalysisAt?: string;
  freshnessStatus?: string;
  inventory: Ec2DashboardInventoryView;
  cost: Ec2DashboardCostView;
  security: Ec2DashboardSecurityView;
  optimization: Ec2DashboardOptimizationView;
  executive: Ec2ExecutiveSummary;
  health: Ec2DashboardHealthView;
  warnings: string[];
  errors: string[];
  reports: Ec2DashboardReportView;
  /** Optional average CPU when telemetry exists; undefined = not analyzed. */
  averageCpuUtilization?: number;
  priorityRecommendations: Ec2RecommendationItem[];
}

export function maskAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (trimmed.length <= 4) {
    return '••••';
  }
  return `••••${trimmed.slice(-4)}`;
}

const RIGHTSIZING_CATEGORIES = new Set([
  'REVIEW_DOWNSIZE',
  'REVIEW_UPSIZE',
  'BURSTABLE_CREDIT_PRESSURE',
  'INSTANCE_FAMILY_UPGRADE',
]);

export function pricingStatusLabel(status: string): string {
  switch (status) {
    case 'VERIFIED_RATE':
      return 'Validated AWS rate';
    case 'CONTROLLED_CATALOG_SAMPLE':
      return 'Sample cost estimate — not an AWS bill';
    case 'UNAVAILABLE':
      return 'Pricing unavailable';
    default:
      return 'Pricing unavailable';
  }
}

export function mapViewModelToEc2Summary(vm: Ec2DashboardViewModel): Ec2DashboardSummary {
  const securityFindingsCount =
    vm.security.status === 'READY' || vm.security.status === 'PARTIAL'
      ? vm.security.findings.reduce((n, f) => n + f.count, 0)
      : 0;

  return {
    region: vm.region,
    totalInstances: vm.inventory.totalInstances,
    runningInstances: vm.inventory.runningInstances,
    stoppedInstances: vm.inventory.stoppedInstances,
    monthlyCost: vm.cost.estimatedMonthlyCost ?? 0,
    averageCpuUtilization: vm.averageCpuUtilization ?? Number.NaN,
    rightsizingOpportunities: vm.optimization.rightsizing.length,
    securityFindings: securityFindingsCount,
    governanceScore: vm.security.governanceScore ?? Number.NaN,
    recommendations: vm.priorityRecommendations,
    monthlyCostLabel: vm.cost.pricingLabel,
    averageCpuLabel:
      vm.averageCpuUtilization === undefined ? 'Not analyzed' : undefined,
    governanceLabel:
      vm.security.governanceScore === undefined ? 'Unavailable' : undefined,
    monthlyCostUnavailable: vm.cost.estimatedMonthlyCost === undefined,
  };
}

export function mapViewModelToCostBreakdown(vm: Ec2DashboardViewModel): Ec2CostBreakdown {
  if (vm.cost.costBreakdown) {
    return vm.cost.costBreakdown;
  }
  const current = vm.cost.estimatedMonthlyCost ?? 0;
  const savings =
    vm.cost.validatedMonthlySavings > 0
      ? vm.cost.validatedMonthlySavings
      : vm.mode === 'demo'
        ? vm.cost.sampleEstimateMonthlySavings
        : vm.cost.validatedMonthlySavings;
  return {
    currentMonthlyCost: current,
    estimatedSavings: savings,
    computeCost: 0,
    storageCost: 0,
    networkCost: 0,
    otherCost: 0,
    savingsLabel:
      vm.mode === 'live' && vm.cost.sampleEstimateMonthlySavings > 0
        ? `Sample estimate $${vm.cost.sampleEstimateMonthlySavings.toFixed(2)} (not validated)`
        : vm.mode === 'live' && vm.cost.validatedMonthlySavings === 0
          ? undefined
          : vm.cost.pricingLabel,
    showBreakdownDetails: Boolean(vm.cost.costBreakdown) && current > 0,
  };
}

export function mapViewModelToInstanceMix(vm: Ec2DashboardViewModel): Ec2InstanceMix {
  const entries = Object.entries(vm.inventory.instancesByType);
  const total = vm.inventory.totalInstances;
  if (entries.length === 0 || total === 0) {
    return { total: 0, byFamily: [] };
  }
  const byFamily = entries.map(([instanceType, count]) => {
    const family = instanceType.split('.')[0] ?? instanceType;
    const share = total > 0 ? Math.round((count / total) * 100) : 0;
    return {
      family,
      count,
      share,
      monthlyCost: 0,
    };
  });
  return { total, byFamily };
}

export function mapViewModelToSecurityFindings(vm: Ec2DashboardViewModel): {
  findings: Ec2SecurityFinding[];
  unavailableMessage?: string;
} {
  if (vm.security.status !== 'READY' && vm.security.status !== 'PARTIAL') {
    return {
      findings: [],
      unavailableMessage:
        vm.security.message ??
        (vm.security.status === 'NOT_ANALYZED'
          ? 'Security analysis not yet analyzed for this account.'
          : 'Security analysis unavailable.'),
    };
  }
  return { findings: vm.security.findings };
}

export function isRightsizingCategory(category: string): boolean {
  return RIGHTSIZING_CATEGORIES.has(category);
}
