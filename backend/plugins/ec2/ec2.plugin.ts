import type { OptimizationPlugin, ProviderInterface } from '../../shared/interfaces';
import type {
  Candidate,
  ConfidenceResult,
  Evidence,
  ExecutionResult,
  FinancialImpact,
  PluginMetadata,
  QualificationResult,
  ReadinessResult,
  Recommendation,
  VerificationResult,
} from '../../shared/types';
import { EVIDENCE_STATUS, PLUGIN_NAMES, VERIFICATION_STATUS } from '../../shared/constants';
import { MOCK_PRICING } from '../../providers/mock/mock-data';

/**
 * EC2 Optimization Plugin — Plugin #1 reference implementation.
 * Returns placeholder values only. No real optimization logic in Sprint 1.
 */
export class Ec2Plugin implements OptimizationPlugin {
  readonly metadata: PluginMetadata = {
    name: PLUGIN_NAMES.EC2,
    version: '1.0.0',
    description: 'EC2 compute optimization plugin',
    resourceTypes: ['ec2'],
  };

  constructor(private readonly provider: ProviderInterface) {}

  async collectCandidates(): Promise<Candidate[]> {
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

  async collectEvidence(candidate: Candidate): Promise<Evidence> {
    const metrics = await this.provider.getMetrics(candidate.resourceId, candidate.region);
    const instanceType = String(candidate.metadata?.instanceType ?? 't3.medium');
    const pricing = await this.provider.getPricing(instanceType, candidate.region);

    const avgCpu =
      metrics.cpuUtilization.reduce((sum, v) => sum + v, 0) / metrics.cpuUtilization.length;
    const avgMemory =
      metrics.memoryUtilization.reduce((sum, v) => sum + v, 0) /
      metrics.memoryUtilization.length;

    return {
      resourceId: candidate.resourceId,
      resourceType: candidate.resourceType,
      region: candidate.region,
      status: EVIDENCE_STATUS.COMPLETE,
      cpuUtilization: Math.round(avgCpu * 100) / 100,
      memoryUtilization: Math.round(avgMemory * 100) / 100,
      monthlyCost: pricing.monthlyRate,
      instanceType,
      tags: candidate.tags,
      metrics: {
        cpuUtilization: metrics.cpuUtilization,
        memoryUtilization: metrics.memoryUtilization,
      },
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
    const factors: string[] = [];
    let score = 0;

    if (evidence.status === EVIDENCE_STATUS.COMPLETE) {
      score += 0.4;
      factors.push('Evidence collection complete');
    }
    if (evidence.monthlyCost !== undefined) {
      score += 0.3;
      factors.push('Pricing data available');
    }
    if (evidence.metrics && Object.keys(evidence.metrics).length > 0) {
      score += 0.3;
      factors.push('Telemetry data present');
    }

    return {
      score: Math.min(score, 1),
      status: score >= 0.7 ? 'ready' : score >= 0.4 ? 'partial' : 'not_ready',
      factors,
    };
  }

  async scoreConfidence(evidence: Evidence): Promise<ConfidenceResult> {
    const cpu = evidence.cpuUtilization ?? 50;
    const stabilityFactor = cpu < 30 ? 0.85 : cpu < 50 ? 0.7 : 0.5;

    return {
      score: stabilityFactor,
      level: stabilityFactor >= 0.8 ? 'high' : stabilityFactor >= 0.6 ? 'medium' : 'low',
      factors: ['Deterministic placeholder scoring — Sprint 1'],
    };
  }

  async recommend(evidence: Evidence): Promise<Recommendation> {
    const recommendations = await this.provider.getRecommendations('ec2', evidence.region);
    const match = recommendations.find((rec) => rec.resourceId === evidence.resourceId);

    return {
      action: match?.action ?? 'resize',
      resourceId: evidence.resourceId,
      resourceType: evidence.resourceType,
      from: evidence.instanceType,
      to: match?.target ?? 't3.medium',
      reason: match?.reason ?? 'Placeholder recommendation — Sprint 1',
      region: evidence.region,
    };
  }

  async estimateFinancialImpact(recommendation: Recommendation): Promise<FinancialImpact> {
    const fromType = recommendation.from ?? 't3.large';
    const toType = recommendation.to ?? 't3.medium';
    const currentPricing = MOCK_PRICING[fromType];
    const recommendedPricing = MOCK_PRICING[toType];

    const currentCost = currentPricing?.monthlyRate ?? 85.2;
    const recommendedCost = recommendedPricing?.monthlyRate ?? 58.6;
    const monthlySavings = Math.round((currentCost - recommendedCost) * 100) / 100;
    const annualSavings = Math.round(monthlySavings * 12 * 100) / 100;
    const roi = currentCost > 0 ? Math.round((monthlySavings / currentCost) * 1000) / 10 : 0;

    return {
      currentCost,
      recommendedCost,
      monthlySavings,
      annualSavings,
      roi,
      currency: 'USD',
    };
  }

  async verify(executionResult: ExecutionResult): Promise<VerificationResult> {
    return {
      status: executionResult.success
        ? VERIFICATION_STATUS.VERIFIED
        : VERIFICATION_STATUS.PENDING,
      expectedSavings: 26.6,
      actualSavings: executionResult.success ? 25.9 : 0,
      variance: executionResult.success ? -0.7 : 0,
      confidenceScore: 0.91,
      message: 'Placeholder verification — Sprint 1',
    };
  }
}

export function createEc2Plugin(provider: ProviderInterface): Ec2Plugin {
  return new Ec2Plugin(provider);
}
