/**
 * Domain models for the EC2 Cost Intelligence Engine (Sprint 15).
 *
 * These types describe the collection -> classification -> financial ->
 * confidence pipeline. They intentionally reuse the existing FinancialImpact
 * and ConfidenceResult shapes from shared/types so the Financial Engine and
 * Confidence Engine can be called unmodified.
 */

import type { ConfidenceResult, FinancialImpact } from './index';
import type { CostFindingSeverity, CostFindingType } from '../constants';

/** Provider-agnostic EC2 instance + actual spend data used as engine input. */
export interface Ec2CostInstance {
  instanceId: string;
  instanceType: string;
  state: string;
  region: string;
  launchTime: string;
  tags: Record<string, string>;
  /** Actual observed monthly cost for this instance (e.g. from Cost Explorer). */
  observedMonthlyCost?: number;
}

/** Bundle collected for one AWS account prior to classification. */
export interface Ec2CostCollectionResult {
  accountId: string;
  region: string;
  instances: Ec2CostInstance[];
  collectedAt: string;
  /** True when real Cost Explorer data was unavailable and cost was inferred from pricing. */
  costDataDegraded: boolean;
}

/** A single cost-intelligence finding for one EC2 instance. */
export interface CostFinding {
  findingId: string;
  tenantId: string;
  accountId: string;
  instanceId: string;
  instanceType: string;
  region: string;
  findingType: CostFindingType;
  severity: CostFindingSeverity;
  reason: string;
  tags: Record<string, string>;
  financialImpact: FinancialImpact;
  confidence: ConfidenceResult;
  metadata?: Record<string, unknown>;
}

/** Aggregate output of one cost-intelligence analysis run. */
export interface CostIntelligenceReport {
  analysisId: string;
  tenantId: string;
  accountId: string;
  region: string;
  generatedAt: string;
  instancesAnalyzed: number;
  findings: CostFinding[];
  totalPotentialMonthlySavings: number;
  currency: string;
  costDataDegraded: boolean;
}
