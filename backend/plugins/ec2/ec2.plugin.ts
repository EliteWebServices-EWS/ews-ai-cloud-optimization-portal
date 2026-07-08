import type { OptimizationPlugin, ProviderInterface } from '../../shared/interfaces';
import type {
  Candidate,
  ConfidenceResult,
  Evidence,
  FinancialImpact,
  PluginMetadata,
  ProviderEvidenceBundle,
  QualificationResult,
  ReadinessResult,
  Recommendation,
  StandardizedEvidence,
} from '../../shared/types';
import { EVIDENCE_STATUS, PLUGIN_NAMES } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { calculateReadiness, DEFAULT_GOVERNANCE_CONFIG } from '../../engines/governance';
import { calculateConfidence, DEFAULT_CONFIDENCE_CONFIG } from '../../engines/confidence';
import {
  calculateFinancialImpact,
  DEFAULT_FINANCIAL_CONFIG,
  resolvePricing,
  resolveProjectedInstanceType,
} from '../../engines/financial';

const logger = createLogger('Ec2Plugin');

/**
 * EC2 Optimization Plugin — Plugin #1 reference implementation.
 * Sprint 6: collects post-execution observations for the Verification Engine.
 */
export class Ec2Plugin implements OptimizationPlugin {
  readonly metadata: PluginMetadata = {
    name: PLUGIN_NAMES.EC2,
    version: '1.1.0',
    description: 'EC2 compute optimization plugin',
    resourceTypes: ['ec2'],
  };

  constructor(private readonly provider: ProviderInterface) {}

  async collectCandidates(): Promise<Candidate[]> {
    logger.info('Collecting EC2 candidates', { plugin: this.metadata.name, operation: 'collectCandidates' });
    const instances = await this.provider.getInstances();
    return instances.map((instance) => ({
      resourceId: instance.instanceId,
      resourceType: 'ec2',
      region: instance.region,
      tags: instance.tags,
      metadata: {
        instanceType: instance.instanceType,
        state: instance.state,
      },
    }));
  }

  async collectProviderEvidence(candidate: Candidate): Promise<ProviderEvidenceBundle> {
    logger.info('Collecting provider evidence', {
      plugin: this.metadata.name,
      operation: 'collectProviderEvidence',
    });

    const instances = await this.provider.getInstances(candidate.region);
    const instance = instances.find((item) => item.instanceId === candidate.resourceId);
    if (!instance) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Instance ${candidate.resourceId} not found in provider inventory`,
        404
      );
    }

    logger.info('Metrics retrieval started', {
      plugin: this.metadata.name,
      operation: 'getMetrics',
    });
    const metrics = await this.provider.getMetrics(candidate.resourceId, candidate.region);

    logger.info('Provider request completed', {
      plugin: this.metadata.name,
      operation: 'getPricing',
    });
    const pricing = await this.provider.getPricing(instance.instanceType, candidate.region);
    const recommendations = await this.provider.getRecommendations('ec2', candidate.region);
    const tags = await this.provider.getTags(candidate.resourceId, candidate.region);

    return {
      instance,
      metrics,
      pricing,
      recommendations,
      tags,
    };
  }

  async collectEvidence(candidate: Candidate): Promise<Evidence> {
    const bundle = await this.collectProviderEvidence(candidate);
    const avgCpu =
      bundle.metrics.cpuUtilization.reduce((sum, value) => sum + value, 0) /
      bundle.metrics.cpuUtilization.length;
    const avgMemory =
      bundle.metrics.memoryUtilization.reduce((sum, value) => sum + value, 0) /
      bundle.metrics.memoryUtilization.length;

    return {
      resourceId: candidate.resourceId,
      resourceType: candidate.resourceType,
      region: candidate.region,
      status: EVIDENCE_STATUS.COMPLETE,
      cpuUtilization: Math.round(avgCpu * 100) / 100,
      memoryUtilization: Math.round(avgMemory * 100) / 100,
      monthlyCost: bundle.pricing.monthlyRate,
      instanceType: bundle.instance.instanceType,
      tags: bundle.tags,
      collectedAt: new Date().toISOString(),
    };
  }

  async qualify(evidence: Evidence): Promise<QualificationResult> {
    const hasMetrics =
      evidence.cpuUtilization !== undefined && evidence.memoryUtilization !== undefined;
    return {
      qualified: hasMetrics,
      reason: hasMetrics
        ? 'Sufficient metrics available for evaluation'
        : 'Insufficient metrics for qualification',
    };
  }

  async scoreReadiness(evidence: Evidence): Promise<ReadinessResult> {
    const standardized = this.toStandardizedEvidence(evidence);
    return calculateReadiness({
      evidence: standardized,
      config: DEFAULT_GOVERNANCE_CONFIG,
    });
  }

  async scoreConfidence(evidence: Evidence): Promise<ConfidenceResult> {
    const standardized = this.toStandardizedEvidence(evidence);
    return calculateConfidence({
      evidence: standardized,
      validation: { valid: true, errors: [], warnings: [] },
      resourceId: evidence.resourceId,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
  }

  async recommend(evidence: Evidence): Promise<Recommendation> {
    const standardized = this.toStandardizedEvidence(evidence);
    const match = standardized.recommendations.find(
      (rec) => rec.resourceId === evidence.resourceId
    );

    return {
      action: match?.action ?? 'resize',
      resourceId: evidence.resourceId,
      resourceType: evidence.resourceType,
      from: evidence.instanceType,
      to: match?.target ?? evidence.instanceType,
      reason: match?.reason ?? 'No provider recommendation hint available',
      region: evidence.region,
    };
  }

  async estimateFinancialImpact(recommendation: Recommendation): Promise<FinancialImpact> {
    const standardized: StandardizedEvidence = {
      telemetry: {
        cpuUtilization: 0,
        memoryUtilization: 0,
        observationWindowDays: 14,
      },
      metrics: {
        cpuUtilization: [],
        memoryUtilization: [],
        period: '1h',
        datapoints: 0,
        utilizationHistory: [],
      },
      pricing: {
        instanceType: recommendation.from ?? 'unknown',
        region: recommendation.region,
        hourlyRate: 0,
        monthlyRate: 0,
        currency: 'USD',
      },
      recommendations: [
        {
          resourceId: recommendation.resourceId,
          resourceType: recommendation.resourceType,
          action: recommendation.action,
          target: recommendation.to ?? recommendation.from ?? 'unknown',
          reason: recommendation.reason,
        },
      ],
      tags: {},
      instance: {
        instanceId: recommendation.resourceId,
        instanceType: recommendation.from ?? 'unknown',
        state: 'running',
        region: recommendation.region,
        launchTime: new Date().toISOString(),
      },
      collectedAt: new Date().toISOString(),
    };

    const currentPricing = await this.provider.getPricing(
      recommendation.from ?? 'unknown',
      recommendation.region
    );
    standardized.pricing = {
      instanceType: currentPricing.instanceType,
      region: currentPricing.region,
      hourlyRate: currentPricing.hourlyRate,
      monthlyRate: currentPricing.monthlyRate,
      currency: currentPricing.currency,
    };

    const projectedType = resolveProjectedInstanceType(standardized, recommendation.resourceId);
    const pricing = await resolvePricing({
      evidence: standardized,
      region: recommendation.region,
      provider: this.provider,
      config: DEFAULT_FINANCIAL_CONFIG,
    });

    return calculateFinancialImpact(
      pricing,
      DEFAULT_FINANCIAL_CONFIG,
      projectedType !== undefined && projectedType.length > 0
    );
  }

  async verify(request: import('../../shared/types').PluginVerifyRequest): Promise<import('../../shared/types').Observation> {
    const { executionResult, recommendation, financialImpact } = request;

    logger.info('Observation collected', {
      plugin: this.metadata.name,
      operation: 'verify',
      executionId: executionResult.executionId,
    });

    if (!executionResult.success) {
      const previousType =
        (executionResult.previousState.instanceType as string | undefined) ??
        recommendation.from ??
        'unknown';

      return {
        resourceId: executionResult.resourceId,
        resourceType: executionResult.resourceType,
        region: recommendation.region,
        collectedAt: new Date().toISOString(),
        instanceType: previousType,
        previousInstanceType: previousType,
        monthlyCostBefore: financialImpact.currentMonthlyCost,
        monthlyCostAfter: financialImpact.currentMonthlyCost,
        observedMonthlySavings: 0,
        metrics: [
          {
            name: 'instanceType',
            expected: recommendation.to ?? previousType,
            observed: previousType,
            matched: false,
          },
          {
            name: 'monthlySavings',
            expected: financialImpact.monthlySavings,
            observed: 0,
            unit: financialImpact.currency,
            matched: false,
          },
        ],
        executionId: executionResult.executionId,
        source: 'simulated',
      };
    }

    const previousType = executionResult.change.from;
    const observedType =
      (executionResult.newState.instanceType as string | undefined) ??
      executionResult.change.to;

    const previousPricing = await this.provider.getPricing(previousType, recommendation.region);
    const observedPricing = await this.provider.getPricing(observedType, recommendation.region);
    const observedMonthlySavings =
      Math.round((previousPricing.monthlyRate - observedPricing.monthlyRate) * 100) / 100;

    return {
      resourceId: executionResult.resourceId,
      resourceType: executionResult.resourceType,
      region: recommendation.region,
      collectedAt: new Date().toISOString(),
      instanceType: observedType,
      previousInstanceType: previousType,
      monthlyCostBefore: previousPricing.monthlyRate,
      monthlyCostAfter: observedPricing.monthlyRate,
      observedMonthlySavings,
      metrics: [
        {
          name: 'instanceType',
          expected: recommendation.to ?? observedType,
          observed: observedType,
          matched: (recommendation.to ?? observedType) === observedType,
        },
        {
          name: 'monthlySavings',
          expected: financialImpact.monthlySavings,
          observed: observedMonthlySavings,
          unit: financialImpact.currency,
          matched: observedMonthlySavings >= financialImpact.monthlySavings,
        },
      ],
      executionId: executionResult.executionId,
      source: 'simulated',
    };
  }

  /** Map legacy Evidence to StandardizedEvidence for readiness scoring. */
  private toStandardizedEvidence(evidence: Evidence): StandardizedEvidence {
    return {
      telemetry: {
        cpuUtilization: evidence.cpuUtilization ?? 0,
        memoryUtilization: evidence.memoryUtilization ?? 0,
        networkUtilization: evidence.networkUtilization,
        observationWindowDays: 14,
      },
      metrics: {
        cpuUtilization: evidence.metrics?.cpuUtilization ?? [],
        memoryUtilization: evidence.metrics?.memoryUtilization ?? [],
        period: '1h',
        datapoints: evidence.metrics?.cpuUtilization.length ?? 0,
        utilizationHistory: [],
      },
      pricing: {
        instanceType: evidence.instanceType ?? 'unknown',
        region: evidence.region,
        hourlyRate: evidence.monthlyCost ? evidence.monthlyCost / 730 : 0,
        monthlyRate: evidence.monthlyCost ?? 0,
        currency: 'USD',
      },
      recommendations: evidence.recommendedInstanceType
        ? [
            {
              resourceId: evidence.resourceId,
              resourceType: evidence.resourceType,
              action: 'resize',
              target: evidence.recommendedInstanceType,
              reason: 'From legacy evidence',
            },
          ]
        : [],
      tags: evidence.tags ?? {},
      instance: {
        instanceId: evidence.resourceId,
        instanceType: evidence.instanceType ?? 'unknown',
        state: 'running',
        region: evidence.region,
        launchTime: evidence.collectedAt,
      },
      collectedAt: evidence.collectedAt,
    };
  }
}

export function createEc2Plugin(provider: ProviderInterface): Ec2Plugin {
  return new Ec2Plugin(provider);
}
