import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';

export const EC2_COST_RECOMMENDATION_CATEGORIES = [
  'STOPPED_WITH_STORAGE',
  'RUNNING_IDLE_CANDIDATE',
  'IDLE_HIGH_CONFIDENCE',
  'IDLE_MEDIUM_CONFIDENCE',
  'INSUFFICIENT_DATA',
  'LONG_RUNNING_IDLE',
  'REVIEW_DOWNSIZE',
  'REVIEW_UPSIZE',
  'BURSTABLE_CREDIT_PRESSURE',
  'INSTANCE_FAMILY_UPGRADE',
] as const;

export type Ec2CostRecommendationCategory = (typeof EC2_COST_RECOMMENDATION_CATEGORIES)[number];

export type Ec2CostRecommendationSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type Ec2CostConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Ec2CostLifecycleStatus = 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED' | 'RESOLVED';
export type Ec2CostAnalysisRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type Ec2PerformanceDataCompleteness = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'NO_DATA';
export type Ec2CostPricingStatus =
  | 'VERIFIED_RATE'
  | 'CONTROLLED_CATALOG_SAMPLE'
  | 'UNAVAILABLE';

export interface Ec2PerformanceEvidence {
  tenantId: string;
  accountId: string;
  region: string;
  instanceId: string;
  observationStart: string;
  observationEnd: string;
  periodSeconds: number;
  expectedSampleCount: number;
  actualSampleCount: number;
  cpuAveragePercent?: number;
  cpuMaximumPercent?: number;
  cpuP95Percent?: number;
  networkInAverageBytes?: number;
  networkOutAverageBytes?: number;
  statusCheckFailureCount?: number;
  cpuCreditBalanceMinimum?: number;
  cpuCreditUsageAverage?: number;
  surplusCreditsChargedTotal?: number;
  dataCompleteness: Ec2PerformanceDataCompleteness;
  collectedAt: string;
  warnings: string[];
}

export interface Ec2CostPricingAssumptions {
  catalogVersion: string;
  priceEffectiveDate: string;
  pricingSource: 'CONTROLLED_CATALOG_SAMPLE';
  currency: 'USD';
  monthlyHours: number;
  pricingModel: 'ON_DEMAND';
  tenancy: 'shared';
  operatingSystem: string;
  region: string;
}

export type Ec2CostPerformanceSummaryAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export interface Ec2CostPerformanceSummary {
  availability: Ec2CostPerformanceSummaryAvailability;
  averageCpuUtilizationPercent?: number;
  instancesEvaluated: number;
  instancesWithMetrics: number;
  instancesIncludedInAverage: number;
  observationStart?: string;
  observationEnd?: string;
}

export interface Ec2CostRecommendationRecord {
  recommendationId: string;
  tenantId: string;
  accountId: string;
  region: string;
  service: 'ec2';
  resourceType: 'INSTANCE' | 'VOLUME';
  resourceId: string;
  category: Ec2CostRecommendationCategory;
  severity: Ec2CostRecommendationSeverity;
  confidenceScore: number;
  confidenceLevel: Ec2CostConfidenceLevel;
  title: string;
  summary: string;
  businessJustification: string;
  recommendedAction: string;
  evidenceSummary: string;
  observedValues: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  currentInstanceType?: string;
  candidateInstanceType?: string;
  currentMonthlyCost?: number;
  projectedMonthlyCost?: number;
  estimatedMonthlySavings?: number;
  estimatedAnnualSavings?: number;
  currency?: 'USD';
  pricingAssumptions?: Ec2CostPricingAssumptions;
  pricingStatus: Ec2CostPricingStatus;
  analysisRunId: string;
  ruleId: string;
  ruleVersion: string;
  lifecycleStatus: Ec2CostLifecycleStatus;
  findingKey: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ec2CostAnalysisRunRecord {
  runId: string;
  tenantId: string;
  accountId: string;
  regions: string[];
  observationDays: number;
  periodSeconds: number;
  requestedAt: string;
  startedAt: string;
  completedAt?: string;
  status: Ec2CostAnalysisRunStatus;
  instancesFound: number;
  instancesEvaluated: number;
  recommendationsCreated: number;
  recommendationsUpdated: number;
  recommendationsResolved: number;
  insufficientDataCount: number;
  regionsSucceeded: string[];
  regionsFailed: string[];
  warnings: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  executionOwnerId?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
  failureRetryable?: boolean;
  performanceSummariesByRegion?: Record<string, Ec2CostPerformanceSummary>;
}

export interface Ec2CostRuleInput {
  tenantId: string;
  accountId: string;
  region: string;
  instance: DiscoveredCloudResourceRecord;
  volumes: DiscoveredCloudResourceRecord[];
  evidence?: Ec2PerformanceEvidence;
  analysisRunId: string;
  observationDays: number;
}

export interface Ec2CostRuleResult {
  category: Ec2CostRecommendationCategory;
  severity: Ec2CostRecommendationSeverity;
  confidenceScore: number;
  confidenceLevel: Ec2CostConfidenceLevel;
  title: string;
  summary: string;
  businessJustification: string;
  recommendedAction: string;
  evidenceSummary: string;
  observedValues: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  currentInstanceType?: string;
  candidateInstanceType?: string;
  currentMonthlyCost?: number;
  projectedMonthlyCost?: number;
  estimatedMonthlySavings?: number;
  estimatedAnnualSavings?: number;
  pricingStatus: Ec2CostPricingStatus;
  pricingAssumptions?: Ec2CostPricingAssumptions;
  resourceType: 'INSTANCE' | 'VOLUME';
  resourceId: string;
}

export interface Ec2CostAnalysisRule {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly category: Ec2CostRecommendationCategory;
  evaluate(input: Ec2CostRuleInput): Ec2CostRuleResult[];
}
