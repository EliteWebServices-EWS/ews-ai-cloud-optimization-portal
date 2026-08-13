import type { Ec2CostRecommendationRecord } from '../cloud-intelligence/ec2-cost/ec2-cost-models';
import { buildRecommendationFingerprintInputFromEc2Cost } from '../persistence-intelligence/recommendation-fingerprint';
import type {
  RecordEvidenceObservationInput,
  RecordEvidenceObservationResult,
} from '../persistence-intelligence/types';
import type { EvidenceObservationRepository } from '../repositories/contracts/evidence-observation-repository';

export interface RecordEc2CostRecommendationObservationInput {
  recommendation: Ec2CostRecommendationRecord;
  observationTimestamp: string;
  collectionTimestamp: string;
  correlationId?: string;
  jobId?: string;
  provenance?: string;
}

export class EvidencePersistenceService {
  constructor(private readonly observations: EvidenceObservationRepository) {}

  buildEc2CostObservationInput(
    input: RecordEc2CostRecommendationObservationInput,
  ): RecordEvidenceObservationInput {
    const recommendation = input.recommendation;
    return {
      tenantId: recommendation.tenantId,
      accountId: recommendation.accountId,
      region: recommendation.region,
      service: recommendation.service,
      resourceType: recommendation.resourceType,
      resourceId: recommendation.resourceId,
      findingKey: recommendation.findingKey,
      recommendationId: recommendation.recommendationId,
      recommendedAction: recommendation.recommendedAction,
      category: recommendation.category,
      ruleId: recommendation.ruleId,
      ruleVersion: recommendation.ruleVersion,
      analysisRunId: recommendation.analysisRunId,
      recommendationVersion: recommendation.version,
      fingerprintInput: buildRecommendationFingerprintInputFromEc2Cost({
        service: recommendation.service,
        resourceType: recommendation.resourceType,
        resourceId: recommendation.resourceId,
        region: recommendation.region,
        category: recommendation.category,
        recommendedAction: recommendation.recommendedAction,
        ruleId: recommendation.ruleId,
        ruleVersion: recommendation.ruleVersion,
        currentInstanceType: recommendation.currentInstanceType,
        candidateInstanceType: recommendation.candidateInstanceType,
        observedValues: recommendation.observedValues,
        thresholds: recommendation.thresholds,
      }),
      observationTimestamp: input.observationTimestamp,
      collectionTimestamp: input.collectionTimestamp,
      provenance: input.provenance ?? 'ec2-cost-analysis',
      correlationId: input.correlationId,
      jobId: input.jobId,
    };
  }

  async recordObservation(input: RecordEvidenceObservationInput): Promise<RecordEvidenceObservationResult> {
    return this.observations.recordObservation(input);
  }

  async recordEc2CostRecommendationObservation(
    input: RecordEc2CostRecommendationObservationInput,
  ): Promise<RecordEvidenceObservationResult> {
    return this.recordObservation(this.buildEc2CostObservationInput(input));
  }
}
