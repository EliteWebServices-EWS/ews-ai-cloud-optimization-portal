import type { ActionLogEmitter } from '../action-log/action-log-emitter';
import type { ActionLogLifecycleContext } from '../action-log/lifecycle-context';
import {
  calculateConfidence,
  DEFAULT_CONFIDENCE_CONFIG,
} from '../engines/confidence';
import type { EvidenceMaturityRepository } from '../repositories/contracts/evidence-maturity-repository';
import type { EvidenceObservationRepository } from '../repositories/contracts/evidence-observation-repository';
import {
  ConfidenceEvidenceService,
  type ComposeConfidenceLongitudinalEvidenceInput,
} from '../services/confidence-evidence-service';
import type { EvidenceValidationResult, StandardizedEvidence } from '../shared/types';
import { evaluateSprint2DecisionReadiness } from './readiness-policy';
import type {
  DecisionReadinessGovernanceConvergenceContext,
  Sprint2DecisionReadinessResult,
} from './types';

export interface AssessSprint2DecisionReadinessInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  recommendationCategory: string;
  recommendationId: string;
  recommendedAction: string;
  resourceId: string;
  evidence: StandardizedEvidence;
  validation: EvidenceValidationResult;
  evaluatedAt: string;
  governanceConvergence: DecisionReadinessGovernanceConvergenceContext;
  sourceObservationId?: string;
  sourceAnalysisRunId?: string;
  sourceObservationTimestamp?: string;
  actionLogContext?: ActionLogLifecycleContext;
}

/**
 * Composes persisted Sprint 1/2 evidence slices and evaluates Sprint 2
 * decision readiness without granting approval or executing actions.
 */
export class DecisionReadinessService {
  private readonly confidenceEvidence: ConfidenceEvidenceService;

  constructor(
    observations: EvidenceObservationRepository,
    maturityRepository: EvidenceMaturityRepository,
    private readonly actionLogEmitter?: ActionLogEmitter,
  ) {
    this.confidenceEvidence = new ConfidenceEvidenceService(observations, maturityRepository);
  }

  async assess(input: AssessSprint2DecisionReadinessInput): Promise<Sprint2DecisionReadinessResult> {
    const composeInput: ComposeConfidenceLongitudinalEvidenceInput = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      sourceObservationId: input.sourceObservationId,
      governanceContextAvailable: input.governanceConvergence.contextAvailable,
    };

    const longitudinalEvidence = await this.confidenceEvidence.compose(composeInput);
    const confidenceResult = calculateConfidence({
      evidence: input.evidence,
      validation: input.validation,
      resourceId: input.resourceId,
      config: DEFAULT_CONFIDENCE_CONFIG,
      longitudinalEvidence: longitudinalEvidence
        ? {
            ...longitudinalEvidence,
            governanceConvergence: {
              contextAvailable: input.governanceConvergence.contextAvailable,
              ruleVersion: input.governanceConvergence.ruleVersion,
            },
          }
        : undefined,
    });

    const persistence = longitudinalEvidence?.persistence;
    const maturity = longitudinalEvidence?.maturity;

    const readiness = evaluateSprint2DecisionReadiness({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      recommendationCategory: input.recommendationCategory,
      recommendationId: input.recommendationId,
      recommendedAction: input.recommendedAction,
      resourceId: input.resourceId,
      evaluatedAt: input.evaluatedAt,
      validation: input.validation,
      longitudinalEvidenceAvailable: longitudinalEvidence != null && persistence != null,
      persistence: {
        state: persistence?.state ?? 'NEW',
        persistenceHours: persistence?.persistenceHours ?? null,
        reasonCodes: persistence?.reasonCodes ?? [],
        sourceObservationId: persistence?.sourceObservationId ?? '',
        logicalObservationId: persistence?.logicalObservationId ?? '',
        ruleId: persistence?.ruleId ?? '',
        ruleVersion: persistence?.ruleVersion ?? '',
      },
      maturity: maturity
        ? {
            maturity: maturity.maturity,
            reasonCodes: maturity.reasonCodes,
            modelVersion: maturity.modelVersion,
            sourceObservationId: maturity.sourceObservationId,
            sourceLogicalObservationId: maturity.sourceLogicalObservationId,
            stableEpochObservationCount: maturity.stableEpochObservationCount,
            stableEpochHours: maturity.stableEpochHours,
            persistenceHours: maturity.persistenceHours,
          }
        : undefined,
      governance: {
        convergence: input.governanceConvergence,
      },
      confidence: {
        status: confidenceResult.status,
        score: confidenceResult.score,
        commercialScore: confidenceResult.commercialScore,
        reasonCodes: confidenceResult.reasonCodes,
        formulaVersion: confidenceResult.formulaVersion,
        confidenceModelVersion: confidenceResult.confidenceModelVersion,
      },
    });

    if (this.actionLogEmitter && input.actionLogContext) {
      await this.actionLogEmitter.emitAfterDecisionReadinessAssessment({
        readiness,
        scope: {
          tenantId: input.tenantId,
          accountId: input.accountId,
          resourceId: input.resourceId,
        },
        context: input.actionLogContext,
      });
    }

    return readiness;
  }
}
