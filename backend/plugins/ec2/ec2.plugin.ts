import type { OptimizationPlugin, ProviderInterface } from '../../shared/interfaces';
import type {
  Candidate,
  ConfidenceResult,
  Evidence,
  ExecutionResult,
  FinancialImpact,
  PluginMetadata,
  ProviderEvidenceBundle,
  QualificationResult,
  ReadinessResult,
  Recommendation,
  StandardizedEvidence,
  VerificationResult,
} from '../../shared/types';
import { EVIDENCE_STATUS, PLUGIN_NAMES, VERIFICATION_STATUS } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { calculateReadiness, DEFAULT_GOVERNANCE_CONFIG } from '../../engines/governance';

const logger = createLogger('Ec2Plugin');

/**
 * EC2 Optimization Plugin — Plugin #1 reference implementation.
 * Sprint 3: delegates readiness scoring to the Governance Engine readiness module.
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

  async scoreConfidence(_evidence: Evidence): Promise<ConfidenceResult> {
    return {
      score: 0,
      level: 'low',
      factors: ['Confidence scoring deferred to Sprint 3+'],
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
      reason: match?.reason ?? 'Recommendation deferred to Sprint 3+',
      region: evidence.region,
    };
  }

  async estimateFinancialImpact(_recommendation: Recommendation): Promise<FinancialImpact> {
    return {
      currentCost: 0,
      recommendedCost: 0,
      monthlySavings: 0,
      annualSavings: 0,
      roi: 0,
      currency: 'USD',
    };
  }

  async verify(executionResult: ExecutionResult): Promise<VerificationResult> {
    return {
      status: executionResult.success
        ? VERIFICATION_STATUS.VERIFIED
        : VERIFICATION_STATUS.PENDING,
      expectedSavings: 0,
      actualSavings: 0,
      variance: 0,
      message: 'Verification deferred to future sprint',
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
