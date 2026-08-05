import { DEFAULT_FINANCIAL_CONFIG, calculateFinancialImpact } from '../financial';

import type { CostFinding, CostIntelligenceReport, Ec2CostCollectionResult, PricingSummary } from '../../shared/types';
import { createLogger, generateCostFindingId } from '../../shared/utils';

import { calculateCostConfidence } from './cost-intelligence.confidence';
import { DEFAULT_COST_INTELLIGENCE_CONFIG, type CostIntelligenceConfig } from './cost-intelligence.config';
import { classifyInstance, type CostRuleMatch } from './cost-intelligence.rules';
import type { Ec2CostDataSource } from './data-source';
import { COST_FINDING_TYPES } from '../../shared/constants';

const logger = createLogger('CostIntelligenceEngine');

export interface CostIntelligenceAnalysisInput {
  analysisId: string;
  tenantId: string;
  collection: Ec2CostCollectionResult;
  dataSource: Ec2CostDataSource;
  config?: CostIntelligenceConfig;
}

async function buildPricingSummary(
  instanceType: string,
  region: string,
  observedMonthlyCost: number | undefined,
  match: CostRuleMatch,
  dataSource: Ec2CostDataSource,
): Promise<{ pricing: PricingSummary; hasProjectedTarget: boolean; pricingResolved: boolean }> {
  const currentReference = await dataSource.getPricing(instanceType, region);
  const currentMonthlyCost = observedMonthlyCost ?? currentReference.monthlyRate;

  const current = {
    instanceType,
    hourlyRate: currentReference.hourlyRate,
    monthlyCost: currentMonthlyCost,
    currency: currentReference.currency,
  };

  if (match.findingType === COST_FINDING_TYPES.PREVIOUS_GENERATION_TYPE && match.suggestedInstanceType) {
    const projectedReference = await dataSource.getPricing(match.suggestedInstanceType, region);
    return {
      pricing: {
        region,
        current,
        projected: {
          instanceType: match.suggestedInstanceType,
          hourlyRate: projectedReference.hourlyRate,
          monthlyCost: projectedReference.monthlyRate,
          currency: projectedReference.currency,
        },
      },
      hasProjectedTarget: true,
      pricingResolved: currentReference.hourlyRate > 0 && projectedReference.hourlyRate > 0,
    };
  }

  // No dollar-savings claim for this finding type (e.g. stopped-retained,
  // untagged) — current === projected, which the Financial Engine already
  // resolves to FINANCIAL_STATUS.INSUFFICIENT_DATA / zero savings.
  return {
    pricing: { region, current, projected: current },
    hasProjectedTarget: false,
    pricingResolved: currentReference.hourlyRate > 0,
  };
}

/**
 * Runs the classify -> financial -> confidence pipeline for one collected
 * AWS account and returns a complete CostIntelligenceReport. Persistence and
 * audit stay in the service layer, exactly as with every other engine.
 */
export async function analyzeEc2Costs(
  input: CostIntelligenceAnalysisInput,
): Promise<CostIntelligenceReport> {
  const config = input.config ?? DEFAULT_COST_INTELLIGENCE_CONFIG;
  const findings: CostFinding[] = [];

  for (const instance of input.collection.instances) {
    const matches = classifyInstance(instance, config);

    for (const match of matches) {
      const { pricing, hasProjectedTarget, pricingResolved } = await buildPricingSummary(
        instance.instanceType,
        instance.region,
        instance.observedMonthlyCost,
        match,
        input.dataSource,
      );

      const financialImpact = calculateFinancialImpact(
        pricing,
        DEFAULT_FINANCIAL_CONFIG,
        hasProjectedTarget,
      );

      if (
        hasProjectedTarget &&
        financialImpact.monthlySavings < config.minMonthlySavingsThreshold
      ) {
        continue;
      }

      const confidence = calculateCostConfidence({
        match,
        costDataObserved: instance.observedMonthlyCost !== undefined,
        pricingResolved,
      });

      findings.push({
        findingId: generateCostFindingId(),
        tenantId: input.tenantId,
        accountId: input.collection.accountId,
        instanceId: instance.instanceId,
        instanceType: instance.instanceType,
        region: instance.region,
        findingType: match.findingType,
        severity: match.severity,
        reason: match.reason,
        tags: instance.tags,
        financialImpact,
        confidence,
        metadata: match.suggestedInstanceType
          ? { suggestedInstanceType: match.suggestedInstanceType }
          : undefined,
      });
    }
  }

  const totalPotentialMonthlySavings =
    Math.round(
      findings.reduce((sum, finding) => sum + Math.max(0, finding.financialImpact.monthlySavings), 0) * 100,
    ) / 100;

  logger.info(
    `EC2 cost intelligence analysis completed: analysisId=${input.analysisId} ` +
      `tenantId=${input.tenantId} accountId=${input.collection.accountId} ` +
      `instancesAnalyzed=${input.collection.instances.length} findings=${findings.length}`,
    { operation: 'analyzeEc2Costs' },
  );

  return {
    analysisId: input.analysisId,
    tenantId: input.tenantId,
    accountId: input.collection.accountId,
    region: input.collection.region,
    generatedAt: new Date().toISOString(),
    instancesAnalyzed: input.collection.instances.length,
    findings,
    totalPotentialMonthlySavings,
    currency: DEFAULT_FINANCIAL_CONFIG.currency,
    costDataDegraded: input.collection.costDataDegraded,
  };
}
