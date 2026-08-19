import { GOVERNANCE_CONVERGENCE_RULE_VERSION } from '../../../governance-convergence/governance-convergence-engine';
import { GOVERNANCE_CONVERGENCE_REASON } from '../../../governance-convergence/reason-codes';
import type { DecisionReadinessGovernanceConvergenceContext } from '../../../decision-readiness/types';
import type { RecordEvidenceObservationInput } from '../../../persistence-intelligence/types';
import type { Ec2PerformanceEvidence } from '../../../cloud-intelligence/ec2-cost/ec2-cost-models';
import type { EvidenceObservationRepository } from '../../../repositories/contracts/evidence-observation-repository';
import type { EvidenceMaturityRepository } from '../../../repositories/contracts/evidence-maturity-repository';
import { EvidenceMaturityService } from '../../../services/evidence-maturity-service';
import {
  buildChangedRecommendationScenario,
  buildMissingPreviousScenario,
  buildNewRecommendationScenario,
  buildOutOfOrderObservationScenario,
  buildPersistentRecommendationScenario,
  type NamedPersistenceScenario,
} from './persistence-scenarios';
import {
  buildHealthyEvidence,
  buildHealthyValidation,
  buildIncompleteEvidence,
  buildIncompleteValidation,
  buildNoDataEvidence,
  buildNoDataValidation,
} from './standardized-evidence';
import {
  EC2_CATEGORY_STOPPED_WITH_STORAGE,
  FIXED_OBSERVATION_TS_1,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from './identities';
import { buildRecordEvidenceObservationInput } from './observation-builders';

const STOPPED_COST_OBSERVATION_DEFAULTS = {
  category: EC2_CATEGORY_STOPPED_WITH_STORAGE,
  ruleId: 'ec2.cost.stopped_with_storage',
} as const;

function mapInputToStoppedCost(input: RecordEvidenceObservationInput): RecordEvidenceObservationInput {
  return buildRecordEvidenceObservationInput({
    identity: {
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      resourceId: input.resourceId,
    },
    ...STOPPED_COST_OBSERVATION_DEFAULTS,
    analysisRunId: input.analysisRunId,
    observationTimestamp: input.observationTimestamp,
    collectionTimestamp: input.collectionTimestamp,
    recommendationVersion: input.recommendationVersion,
    expectedPriorHistory: input.expectedPriorHistory,
    recommendedAction: input.recommendedAction,
    fingerprintInput: input.fingerprintInput,
    jobId: input.jobId,
  });
}

function mapScenarioToStoppedCost(scenario: NamedPersistenceScenario): NamedPersistenceScenario {
  const inputs = scenario.inputs.map(mapInputToStoppedCost);
  return {
    ...scenario,
    inputs,
    findingKey: inputs[0]?.findingKey,
  } as NamedPersistenceScenario;
}

export const DEFAULT_ANALYSIS_RUN_STARTED_AT = FIXED_OBSERVATION_TS_1;

/** Sprint 2 persistence taxonomy aliases for decision-readiness QA. */
export function buildMatureStablePersistenceScenario(): NamedPersistenceScenario {
  return mapScenarioToStoppedCost({
    ...buildPersistentRecommendationScenario(),
    name: 'MATURE_STABLE',
  });
}

export function buildPartialStablePersistenceScenario(): NamedPersistenceScenario {
  const persistent = buildMatureStablePersistenceScenario();
  return {
    name: 'PARTIAL_STABLE',
    inputs: persistent.inputs.slice(0, 2),
    expectedStates: persistent.expectedStates.slice(0, 2),
  };
}

export function buildImmatureNewPersistenceScenario(): NamedPersistenceScenario {
  return mapScenarioToStoppedCost({
    ...buildNewRecommendationScenario(),
    name: 'IMMATURE_NEW',
  });
}

export function buildChangedRecommendationPersistenceScenario(): NamedPersistenceScenario {
  return mapScenarioToStoppedCost({
    ...buildChangedRecommendationScenario(),
    name: 'CHANGED_RECOMMENDATION',
  });
}

export function buildMissingHistoryPersistenceScenario(): NamedPersistenceScenario {
  return mapScenarioToStoppedCost({
    ...buildMissingPreviousScenario(),
    name: 'MISSING_HISTORY',
  });
}

export function buildOutOfOrderPersistenceScenario(): NamedPersistenceScenario {
  return mapScenarioToStoppedCost({
    ...buildOutOfOrderObservationScenario(),
    name: 'OUT_OF_ORDER_OBSERVATION',
  });
}

export function buildBurstableCreditPressurePersistenceScenario(): NamedPersistenceScenario {
  const persistent = buildPersistentRecommendationScenario();
  return {
    name: 'BURSTABLE_CREDIT_PRESSURE',
    inputs: persistent.inputs.map((input) =>
      buildRecordEvidenceObservationInput({
        identity: {
          tenantId: input.tenantId,
          accountId: input.accountId,
          region: input.region,
          resourceId: input.resourceId,
        },
        category: 'BURSTABLE_CREDIT_PRESSURE',
        ruleId: 'ec2.cost.burstable_credit_pressure',
        recommendedAction:
          'Review burstable credit pressure; consider non-burstable types after review.',
        analysisRunId: input.analysisRunId,
        observationTimestamp: input.observationTimestamp,
        collectionTimestamp: input.collectionTimestamp,
        recommendationVersion: input.recommendationVersion,
        fingerprintInput: input.fingerprintInput,
      }),
    ),
    expectedStates: persistent.expectedStates,
  };
}

export function buildGovernancePreservedContext(): DecisionReadinessGovernanceConvergenceContext {
  return {
    state: 'PRESERVED',
    reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.VIOLATION_PERSISTS_UNCHANGED],
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
    contextAvailable: true,
  };
}

export function buildGovernanceImprovedContext(): DecisionReadinessGovernanceConvergenceContext {
  return {
    state: 'IMPROVED',
    reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.VIOLATION_RESOLVED],
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
    contextAvailable: true,
  };
}

export function buildGovernanceReplacedContext(): DecisionReadinessGovernanceConvergenceContext {
  return {
    state: 'REPLACED',
    reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.MECHANISM_CHANGED_STILL_SATISFIED],
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
    contextAvailable: true,
  };
}

export function buildGovernanceMissingContext(): DecisionReadinessGovernanceConvergenceContext {
  return {
    state: 'MISSING',
    reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.CURRENT_EVIDENCE_ABSENT],
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
    contextAvailable: true,
  };
}

export function buildGovernanceUnavailableContext(): DecisionReadinessGovernanceConvergenceContext {
  return {
    state: 'PRESERVED',
    reasonCodes: [],
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
    contextAvailable: false,
  };
}

export function buildHighConfidenceMatureEvidenceInput() {
  return {
    evidence: buildHealthyEvidence(),
    validation: buildHealthyValidation(),
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
  };
}

export function buildMediumConfidencePartialEvidenceInput() {
  return {
    evidence: buildHealthyEvidence(),
    validation: buildHealthyValidation(),
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
  };
}

export function buildLowConfidenceImmatureEvidenceInput() {
  return {
    evidence: buildHealthyEvidence(),
    validation: buildHealthyValidation(),
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
  };
}

export function buildIncompleteEvidenceInput() {
  return {
    evidence: buildIncompleteEvidence(),
    validation: buildIncompleteValidation(),
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
  };
}

export function buildNoDataEvidenceInput() {
  return {
    evidence: buildNoDataEvidence(),
    validation: buildNoDataValidation(),
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
  };
}

export interface ReplayCostEvidencePipelineResult {
  lastInput: RecordEvidenceObservationInput;
  lastObservationId: string;
  lastLogicalObservationId: string;
  lastPersistenceState: string;
  lastMaturity?: string;
}

/**
 * Replays deterministic cost-evidence inputs through production persistence and
 * maturity services. Governance convergence remains a separate domain path and
 * must be supplied explicitly to decision-readiness assessment.
 */
export async function replayCostEvidencePipeline(input: {
  observations: EvidenceObservationRepository;
  maturityRepository: EvidenceMaturityRepository;
  scenario: NamedPersistenceScenario;
  currentPerformanceEvidence?: Pick<Ec2PerformanceEvidence, 'dataCompleteness'>;
}): Promise<ReplayCostEvidencePipelineResult> {
  const maturity = new EvidenceMaturityService(input.maturityRepository, input.observations);
  let lastObservationId = '';
  let lastLogicalObservationId = '';
  let lastPersistenceState = 'NEW';
  let lastMaturity: string | undefined;

  for (const scenarioInput of input.scenario.inputs) {
    const recorded = await input.observations.recordObservation(scenarioInput);
    const maturityResult = await maturity.evaluateAndPersist({
      observation: recorded.observation,
      evaluatedAt: scenarioInput.observationTimestamp,
      currentPerformanceEvidence: input.currentPerformanceEvidence as Ec2PerformanceEvidence | undefined,
    });
    lastObservationId = recorded.observation.observationId;
    lastLogicalObservationId = recorded.observation.logicalObservationId;
    lastPersistenceState = recorded.observation.assessment.state;
    lastMaturity = maturityResult.record.maturity;
  }

  const lastInput = input.scenario.inputs[input.scenario.inputs.length - 1]!;
  return {
    lastInput,
    lastObservationId,
    lastLogicalObservationId,
    lastPersistenceState,
    lastMaturity,
  };
}

export const ALL_SPRINT2_DECISION_READINESS_PERSISTENCE_ALIASES = [
  buildMatureStablePersistenceScenario(),
  buildPartialStablePersistenceScenario(),
  buildImmatureNewPersistenceScenario(),
  buildChangedRecommendationPersistenceScenario(),
  buildMissingHistoryPersistenceScenario(),
] as const;

export const ALL_SPRINT2_GOVERNANCE_CONTEXT_FIXTURES = {
  GOVERNANCE_PRESERVED: buildGovernancePreservedContext(),
  GOVERNANCE_IMPROVED: buildGovernanceImprovedContext(),
  GOVERNANCE_REPLACED: buildGovernanceReplacedContext(),
  GOVERNANCE_MISSING: buildGovernanceMissingContext(),
  GOVERNANCE_UNAVAILABLE: buildGovernanceUnavailableContext(),
} as const;
