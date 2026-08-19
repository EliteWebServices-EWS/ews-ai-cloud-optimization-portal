import type { AssessSprint2DecisionReadinessInput } from '../../decision-readiness/decision-readiness-service';
import type { DecisionReadinessGovernanceConvergenceContext } from '../../decision-readiness/types';
import type { ReplayCostEvidencePipelineResult } from '../fixtures/evidence/decision-readiness-scenarios';
import type { StandardizedEvidence, EvidenceValidationResult } from '../../shared/types';

export function buildAssessInputFromPipeline(input: {
  pipeline: ReplayCostEvidencePipelineResult;
  evidence: StandardizedEvidence;
  validation: EvidenceValidationResult;
  resourceId: string;
  governanceConvergence: DecisionReadinessGovernanceConvergenceContext;
  overrides?: Partial<AssessSprint2DecisionReadinessInput>;
}): AssessSprint2DecisionReadinessInput {
  return {
    tenantId: input.pipeline.lastInput.tenantId,
    accountId: input.pipeline.lastInput.accountId,
    findingKey: input.pipeline.lastInput.findingKey,
    recommendationCategory: input.pipeline.lastInput.category,
    recommendationId: input.pipeline.lastInput.recommendationId,
    recommendedAction: input.pipeline.lastInput.recommendedAction,
    resourceId: input.resourceId,
    evidence: input.evidence,
    validation: input.validation,
    evaluatedAt: input.pipeline.lastInput.observationTimestamp,
    governanceConvergence: input.governanceConvergence,
    sourceObservationId: input.pipeline.lastObservationId,
    ...input.overrides,
  };
}
