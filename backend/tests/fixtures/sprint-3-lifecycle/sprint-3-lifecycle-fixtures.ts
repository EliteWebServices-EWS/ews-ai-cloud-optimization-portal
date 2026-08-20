import { EXECUTION_STATUS, PLUGIN_NAMES, RECOMMENDATION_STATUS } from '../../../shared/constants';
import type {
  ExecutionResult,
  Observation,
  VerificationExpectation,
} from '../../../shared/types';
import type { EvaluatePostActionVerificationInput } from '../../../post-action-verification/types';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  FIXED_COLLECTED_AT,
  REGION,
  RESOURCE_ID_A,
  TENANT_A,
  TENANT_B,
} from '../evidence/identities';
import {
  buildPostActionDegradationObservation,
  buildPostActionSuccessObservation,
} from '../evidence/lifecycle-fixtures';

export const FIXED_VERIFICATION_EVALUATED_AT = '2026-08-20T12:00:00.000Z';
export const SPRINT3_CORRELATION_ID = 'corr-sprint3-lifecycle';
export const SPRINT3_WORKFLOW_ID = 'wf-sprint3-lifecycle';
export const SPRINT3_EXECUTION_ID = 'exec-sprint3-lifecycle';
export const SPRINT3_DECISION_ID = 'decision-sprint3-lifecycle';
export const SPRINT3_RECOMMENDATION_ID = 'rec-burstable-credit-pressure';
export const SPRINT3_FINDING_KEY = 'finding-burstable-credit-pressure';

export function buildVerificationExpectation(
  overrides: Partial<VerificationExpectation> = {},
): VerificationExpectation {
  return {
    expectedMonthlySavings: 15,
    expectedInstanceType: 't3.small',
    previousInstanceType: 't3.medium',
    currency: 'USD',
    ...overrides,
  };
}

export function buildCompletedExecutionResult(
  overrides: Partial<ExecutionResult> = {},
): ExecutionResult {
  return {
    executionId: SPRINT3_EXECUTION_ID,
    status: EXECUTION_STATUS.COMPLETED,
    resourceId: RESOURCE_ID_A,
    resourceType: 'EC2',
    action: 'RESIZE_INSTANCE',
    success: true,
    executedAt: FIXED_VERIFICATION_EVALUATED_AT,
    change: {
      action: 'RESIZE_INSTANCE',
      from: 't3.medium',
      to: 't3.small',
      resourceType: 'EC2',
    },
    previousState: { instanceType: 't3.medium' },
    newState: { instanceType: 't3.small' },
    metadata: {
      tenantId: TENANT_A,
      workflowId: SPRINT3_WORKFLOW_ID,
      plugin: PLUGIN_NAMES.EC2,
      region: REGION,
      simulated: true,
      recommendationStatus: RECOMMENDATION_STATUS.RECOMMENDED,
    },
    ...overrides,
  };
}

export function buildFailedExecutionResult(): ExecutionResult {
  return buildCompletedExecutionResult({
    status: EXECUTION_STATUS.FAILED,
    success: false,
    message: 'Execution failed',
  });
}

export function buildPendingExecutionResult(): ExecutionResult {
  return buildCompletedExecutionResult({
    status: EXECUTION_STATUS.PENDING,
    success: false,
    message: 'Execution pending',
  });
}

export function buildSkippedExecutionResult(): ExecutionResult {
  return buildCompletedExecutionResult({
    status: EXECUTION_STATUS.SKIPPED,
    success: false,
    message: 'Execution skipped',
  });
}

function buildEvidenceReferences(overrides: {
  executionId?: string;
  beforeId?: string;
  afterId?: string | null;
  recommendationId?: string;
  telemetryId?: string;
  expectedImpactId?: string;
  observedImpactId?: string | null;
}) {
  return {
    executionReference: {
      sourceRecordId: overrides.executionId ?? SPRINT3_EXECUTION_ID,
      sourceRecordVersion: '1',
    },
    beforeEvidenceReference: {
      sourceRecordId: overrides.beforeId ?? 'obs-before-001',
      sourceRecordVersion: '1',
    },
    afterEvidenceReference:
      overrides.afterId === null
        ? null
        : {
            sourceRecordId: overrides.afterId ?? 'obs-after-001',
            sourceRecordVersion: '1',
          },
    recommendationStateReference: {
      sourceRecordId: overrides.recommendationId ?? 'rec-state-001',
      sourceRecordVersion: '1',
    },
    telemetryEvidenceReference: {
      sourceRecordId: overrides.telemetryId ?? 'telemetry-001',
      sourceRecordVersion: '1',
    },
    expectedImpactReference: {
      sourceRecordId: overrides.expectedImpactId ?? 'impact-expected-001',
      sourceRecordVersion: '1',
    },
    observedImpactReference:
      overrides.observedImpactId === null
        ? null
        : {
            sourceRecordId: overrides.observedImpactId ?? 'impact-observed-001',
            sourceRecordVersion: '1',
          },
  };
}

export function buildPostActionAssessmentInput(
  overrides: Partial<
    Omit<EvaluatePostActionVerificationInput, 'comparatorResult'>
  > & {
    comparatorResult?: EvaluatePostActionVerificationInput['comparatorResult'];
  } = {},
): Omit<EvaluatePostActionVerificationInput, 'comparatorResult'> {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const accountId = overrides.accountId ?? ACCOUNT_A;
  const refs = buildEvidenceReferences({
    afterId: overrides.afterEvidenceReference === null ? null : undefined,
    observedImpactId:
      overrides.observedImpactReference === null ? null : undefined,
  });

  return {
    tenantId,
    accountId,
    evidenceContextScope: overrides.evidenceContextScope ?? { tenantId, accountId },
    evaluatedAt: overrides.evaluatedAt ?? FIXED_VERIFICATION_EVALUATED_AT,
    assessmentId: overrides.assessmentId ?? 'assessment-sprint3-001',
    recommendationState: overrides.recommendationState ?? {
      findingKey: SPRINT3_FINDING_KEY,
      recommendationId: SPRINT3_RECOMMENDATION_ID,
      present: false,
      sufficientEvidence: true,
    },
    telemetry: overrides.telemetry ?? {
      available: true,
      qualityAdequate: true,
      degraded: false,
    },
    executionCompleted: overrides.executionCompleted ?? true,
    ...refs,
    ...overrides,
  };
}

export function buildExecutionApiSuccessVerificationHealthyInput() {
  return {
    expectation: buildVerificationExpectation(),
    observation: buildPostActionSuccessObservation(),
    executionResult: buildCompletedExecutionResult(),
    assessmentInput: buildPostActionAssessmentInput({
      recommendationState: {
        findingKey: SPRINT3_FINDING_KEY,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
        present: true,
        sufficientEvidence: true,
      },
    }),
  };
}

export function buildExecutionApiSuccessRecommendationPersistsInput() {
  return buildExecutionApiSuccessVerificationHealthyInput();
}

export function buildExecutionApiSuccessRecommendationResolvedInput() {
  return {
    expectation: buildVerificationExpectation(),
    observation: buildPostActionSuccessObservation(),
    executionResult: buildCompletedExecutionResult(),
    assessmentInput: buildPostActionAssessmentInput({
      recommendationState: {
        findingKey: SPRINT3_FINDING_KEY,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
        present: false,
        sufficientEvidence: true,
      },
    }),
  };
}

export function buildPostActionDegradedInput() {
  return {
    expectation: buildVerificationExpectation(),
    observation: buildPostActionDegradationObservation(),
    executionResult: buildCompletedExecutionResult({
      change: {
        action: 'RESIZE_INSTANCE',
        from: 't3.medium',
        to: 't3.medium',
        resourceType: 'EC2',
      },
    }),
    assessmentInput: buildPostActionAssessmentInput({
      recommendationState: {
        findingKey: SPRINT3_FINDING_KEY,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
        present: true,
        sufficientEvidence: true,
      },
      telemetry: {
        available: true,
        qualityAdequate: true,
        degraded: true,
      },
    }),
  };
}

export function buildPostActionInsufficientEvidenceInput() {
  return {
    expectation: buildVerificationExpectation(),
    observation: null as Observation | null,
    executionResult: buildCompletedExecutionResult(),
    assessmentInput: buildPostActionAssessmentInput({
      afterEvidenceReference: null,
      observedImpactReference: null,
      telemetry: {
        available: null,
        qualityAdequate: null,
        degraded: null,
      },
    }),
  };
}

export function buildCrossTenantVerificationDeniedInput() {
  return buildPostActionAssessmentInput({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    evidenceContextScope: { tenantId: TENANT_B, accountId: ACCOUNT_B },
  });
}

export function buildCrossAccountVerificationDeniedInput() {
  return buildPostActionAssessmentInput({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    evidenceContextScope: { tenantId: TENANT_A, accountId: ACCOUNT_B },
  });
}

export const SPRINT3_LIFECYCLE_FIXTURE_CATALOG = [
  'ML_EXECUTED_SUCCESS',
  'ML_INELIGIBLE_DETERMINISTIC_FALLBACK',
  'ML_MODEL_UNAVAILABLE_FAILED_SAFE',
  'APPROVAL_REQUIRED_GRANTED',
  'APPROVAL_REQUIRED_MISSING',
  'SIMULATION_ONLY',
  'EXECUTION_API_SUCCESS_VERIFICATION_HEALTHY',
  'EXECUTION_API_SUCCESS_RECOMMENDATION_PERSISTS',
  'POST_ACTION_DEGRADED',
  'POST_ACTION_INSUFFICIENT_EVIDENCE',
  'CROSS_TENANT_ACTION_DENIED',
] as const;

export function buildFreshLifecycleFixtureInputs() {
  return {
    healthy: buildExecutionApiSuccessVerificationHealthyInput(),
    recommendationPersists: buildExecutionApiSuccessRecommendationPersistsInput(),
    resolved: buildExecutionApiSuccessRecommendationResolvedInput(),
    degraded: buildPostActionDegradedInput(),
    insufficientEvidence: buildPostActionInsufficientEvidenceInput(),
    crossTenantDenied: buildCrossTenantVerificationDeniedInput(),
    crossAccountDenied: buildCrossAccountVerificationDeniedInput(),
    collectedAt: FIXED_COLLECTED_AT,
  };
}
