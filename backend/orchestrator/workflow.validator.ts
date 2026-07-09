/**
 * Workflow validation layer — ensures required inputs exist before engine calls.
 * Sprint 7: validates previous stage completion and data format.
 */

import {
  WORKFLOW_EXECUTION_STATES,
  WORKFLOW_STAGES,
  type WorkflowExecutionState,
  type WorkflowStage,
} from '../shared/constants';
import type { WorkflowContext } from './workflow.types';
import { WorkflowValidationError } from './workflow.errors';
import { isStageEnabled, type WorkflowConfig } from './workflow.config';

const STAGE_PREREQUISITES: Record<WorkflowStage, WorkflowStage[]> = {
  [WORKFLOW_STAGES.EVIDENCE]: [],
  [WORKFLOW_STAGES.QUALIFICATION]: [WORKFLOW_STAGES.EVIDENCE],
  [WORKFLOW_STAGES.GOVERNANCE]: [WORKFLOW_STAGES.EVIDENCE],
  [WORKFLOW_STAGES.FINANCIAL]: [WORKFLOW_STAGES.GOVERNANCE],
  [WORKFLOW_STAGES.CONFIDENCE]: [WORKFLOW_STAGES.FINANCIAL],
  [WORKFLOW_STAGES.RECOMMENDATION]: [WORKFLOW_STAGES.CONFIDENCE],
  [WORKFLOW_STAGES.EXECUTION]: [WORKFLOW_STAGES.RECOMMENDATION],
  [WORKFLOW_STAGES.VERIFICATION]: [WORKFLOW_STAGES.EXECUTION],
  [WORKFLOW_STAGES.LEARNING]: [WORKFLOW_STAGES.VERIFICATION],
};

const STAGE_EXECUTION_STATE: Record<WorkflowStage, WorkflowExecutionState> = {
  [WORKFLOW_STAGES.EVIDENCE]: WORKFLOW_EXECUTION_STATES.EVIDENCE_COLLECTION,
  [WORKFLOW_STAGES.QUALIFICATION]: WORKFLOW_EXECUTION_STATES.EVIDENCE_COLLECTION,
  [WORKFLOW_STAGES.GOVERNANCE]: WORKFLOW_EXECUTION_STATES.GOVERNANCE_EVALUATION,
  [WORKFLOW_STAGES.FINANCIAL]: WORKFLOW_EXECUTION_STATES.FINANCIAL_ANALYSIS,
  [WORKFLOW_STAGES.CONFIDENCE]: WORKFLOW_EXECUTION_STATES.CONFIDENCE_ANALYSIS,
  [WORKFLOW_STAGES.RECOMMENDATION]: WORKFLOW_EXECUTION_STATES.RECOMMENDATION_GENERATION,
  [WORKFLOW_STAGES.EXECUTION]: WORKFLOW_EXECUTION_STATES.EXECUTION,
  [WORKFLOW_STAGES.VERIFICATION]: WORKFLOW_EXECUTION_STATES.VERIFICATION,
  [WORKFLOW_STAGES.LEARNING]: WORKFLOW_EXECUTION_STATES.OUTCOME_STORAGE,
};

/** Assert that prerequisite stages completed successfully. */
export function validateStagePrerequisites(
  context: WorkflowContext,
  stage: WorkflowStage
): void {
  const executionState = STAGE_EXECUTION_STATE[stage];

  if (context.failedStages.length > 0) {
    throw new WorkflowValidationError(
      `Cannot run ${stage} stage: workflow has failed stages (${context.failedStages.join(', ')})`,
      executionState,
      stage
    );
  }

  const prerequisites = STAGE_PREREQUISITES[stage];

  for (const prerequisite of prerequisites) {
    if (!context.completedStages.includes(prerequisite)) {
      throw new WorkflowValidationError(
        `Cannot run ${stage} stage: prerequisite ${prerequisite} has not completed`,
        executionState,
        stage
      );
    }
  }
}

/** Validate that evidence stage inputs and outputs are present. */
export function validateEvidenceStage(context: WorkflowContext): void {
  const state = WORKFLOW_EXECUTION_STATES.EVIDENCE_COLLECTION;
  if (!context.candidate) {
    throw new WorkflowValidationError('Candidate is required for evidence collection', state);
  }
}

/** Validate governance stage inputs. */
export function validateGovernanceStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.GOVERNANCE);
  const state = WORKFLOW_EXECUTION_STATES.GOVERNANCE_EVALUATION;
  if (!context.evidence || !context.evidenceStatus || !context.validation) {
    throw new WorkflowValidationError(
      'Evidence data is required before governance evaluation',
      state,
      WORKFLOW_STAGES.GOVERNANCE
    );
  }
}

/** Validate financial stage inputs — do not call if governance failed. */
export function validateFinancialStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.FINANCIAL);
  const state = WORKFLOW_EXECUTION_STATES.FINANCIAL_ANALYSIS;
  if (!context.governance) {
    throw new WorkflowValidationError(
      'Governance result is required before financial analysis',
      state,
      WORKFLOW_STAGES.FINANCIAL
    );
  }
}

/** Validate confidence stage inputs. */
export function validateConfidenceStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.CONFIDENCE);
  const state = WORKFLOW_EXECUTION_STATES.CONFIDENCE_ANALYSIS;
  if (!context.financialImpact) {
    throw new WorkflowValidationError(
      'Financial impact is required before confidence analysis',
      state,
      WORKFLOW_STAGES.CONFIDENCE
    );
  }
}

/** Validate recommendation stage inputs. */
export function validateRecommendationStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.RECOMMENDATION);
  const state = WORKFLOW_EXECUTION_STATES.RECOMMENDATION_GENERATION;
  if (!context.confidence) {
    throw new WorkflowValidationError(
      'Confidence result is required before recommendation generation',
      state,
      WORKFLOW_STAGES.RECOMMENDATION
    );
  }
}

/** Validate execution stage inputs. */
export function validateExecutionStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.EXECUTION);
  const state = WORKFLOW_EXECUTION_STATES.EXECUTION;
  if (!context.recommendation) {
    throw new WorkflowValidationError(
      'Recommendation is required before execution simulation',
      state,
      WORKFLOW_STAGES.EXECUTION
    );
  }
}

/** Validate verification stage inputs. */
export function validateVerificationStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.VERIFICATION);
  const state = WORKFLOW_EXECUTION_STATES.VERIFICATION;
  if (!context.execution || !context.observation) {
    throw new WorkflowValidationError(
      'Execution result and observation are required before verification',
      state,
      WORKFLOW_STAGES.VERIFICATION
    );
  }
}

/** Validate learning stage inputs. */
export function validateLearningStage(context: WorkflowContext): void {
  validateStagePrerequisites(context, WORKFLOW_STAGES.LEARNING);
  const state = WORKFLOW_EXECUTION_STATES.OUTCOME_STORAGE;
  if (!context.verification) {
    throw new WorkflowValidationError(
      'Verification result is required before outcome storage',
      state,
      WORKFLOW_STAGES.LEARNING
    );
  }
}

/** Validate stage is enabled in workflow configuration. */
export function validateStageEnabled(config: WorkflowConfig, stage: WorkflowStage): void {
  if (!isStageEnabled(config, stage)) {
    throw new WorkflowValidationError(
      `Stage ${stage} is not enabled in workflow configuration`,
      STAGE_EXECUTION_STATE[stage],
      stage
    );
  }
}

export { STAGE_EXECUTION_STATE };
