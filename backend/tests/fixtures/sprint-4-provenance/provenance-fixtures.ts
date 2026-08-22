import { prepareActionLogRecord } from '../../../action-log/record-builder';
import type { ActionLogRecord, RecordActionLogEventInput } from '../../../action-log/types';
import type { MockVerificationRepository } from '../../../engines/verification/mock-verification.repository';
import { getStageProvenanceClass } from '../../../provenance-reconstruction/stage-provenance';
import type {
  ProvenanceSourceAvailability,
  ProvenanceSourceReference,
} from '../../../provenance-reconstruction/types';
import type { MockExecutionPlanRepository } from '../../../repositories/mock/mock-execution-plan-repository';
import { VERIFICATION_STATUS } from '../../../shared/constants';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
} from '../evidence/identities';

export const SPRINT4_CORRELATION_ID = 'corr-sprint4-provenance';
export const SPRINT4_DECISION_ID = 'decision-sprint4-provenance';
export const SPRINT4_EXECUTION_ID = 'exec-sprint4-provenance';
export const SPRINT4_WORKFLOW_ID = 'wf-sprint4-provenance';

const BASE_TIME = '2026-08-20T10:00:00.000Z';

function buildEvent(
  overrides: Partial<RecordActionLogEventInput> & Pick<
    RecordActionLogEventInput,
    'eventType' | 'sourceStage' | 'sourceRecordId'
  >,
): ActionLogRecord {
  return prepareActionLogRecord({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: SPRINT4_CORRELATION_ID,
    decisionId: SPRINT4_DECISION_ID,
    workflowId: SPRINT4_WORKFLOW_ID,
    executionId: SPRINT4_EXECUTION_ID,
    occurredAt: BASE_TIME,
    ...overrides,
  });
}

export function buildCompleteExecutedAndVerifiedEvents(): ActionLogRecord[] {
  return [
    buildEvent({
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: 'rec-001',
      reasonCodes: ['COST_EVIDENCE_ATTACHED'],
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
    buildEvent({
      eventType: 'ML_EXECUTED',
      sourceStage: 'ML',
      sourceRecordId: 'ml-001',
      occurredAt: '2026-08-20T10:05:00.000Z',
    }),
    buildEvent({
      eventType: 'APPROVAL_GRANTED',
      sourceStage: 'APPROVAL',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:10:00.000Z',
    }),
    buildEvent({
      eventType: 'EXECUTION_SUCCEEDED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:15:00.000Z',
    }),
    buildEvent({
      eventType: 'VERIFICATION_COMPLETED',
      sourceStage: 'VERIFICATION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:20:00.000Z',
    }),
  ];
}

export function buildCompleteNoMlFallbackEvents(): ActionLogRecord[] {
  return [
    buildEvent({
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: 'rec-001',
      reasonCodes: ['COST_EVIDENCE_ATTACHED'],
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
    buildEvent({
      eventType: 'ML_FAILED_SAFE',
      sourceStage: 'ML',
      sourceRecordId: 'ml-fallback-001',
      occurredAt: '2026-08-20T10:05:00.000Z',
    }),
    buildEvent({
      eventType: 'APPROVAL_GRANTED',
      sourceStage: 'APPROVAL',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:10:00.000Z',
    }),
    buildEvent({
      eventType: 'EXECUTION_SUCCEEDED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:15:00.000Z',
    }),
    buildEvent({
      eventType: 'VERIFICATION_COMPLETED',
      sourceStage: 'VERIFICATION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:20:00.000Z',
    }),
  ];
}

export function buildCompleteSimulationEvents(): ActionLogRecord[] {
  return [
    buildEvent({
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: 'rec-001',
      reasonCodes: ['COST_EVIDENCE_ATTACHED'],
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
    buildEvent({
      eventType: 'EXECUTION_SIMULATED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:10:00.000Z',
    }),
  ];
}

export function buildCompleteRollbackEvents(): ActionLogRecord[] {
  /**
   * Contract-only golden vector for execution-failure + verification-insufficient
   * advisory paths. ActionLog v1 has no durable rollback execution stages; Engineer 4
   * must add those before this vector can classify COMPLETE for rollback lifecycle.
   */
  return [
    buildEvent({
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: 'rec-001',
      reasonCodes: ['COST_EVIDENCE_ATTACHED'],
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
    buildEvent({
      eventType: 'APPROVAL_GRANTED',
      sourceStage: 'APPROVAL',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:05:00.000Z',
    }),
    buildEvent({
      eventType: 'EXECUTION_FAILED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:10:00.000Z',
    }),
    buildEvent({
      eventType: 'VERIFICATION_INSUFFICIENT_EVIDENCE',
      sourceStage: 'VERIFICATION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:15:00.000Z',
    }),
  ];
}

export function buildPartialMissingCostEvidenceEvents(): ActionLogRecord[] {
  return buildCompleteExecutedAndVerifiedEvents().map((event) =>
    event.sourceStage === 'RECOMMENDATION'
      ? { ...event, reasonCodes: undefined }
      : event,
  );
}

export function buildPartialMissingLearningEvents(): ActionLogRecord[] {
  return [
    ...buildCompleteExecutedAndVerifiedEvents(),
    buildEvent({
      eventType: 'DECISION_READINESS_EVALUATED',
      sourceStage: 'DECISION_READINESS',
      sourceRecordId: 'readiness-001',
      occurredAt: '2026-08-20T10:04:00.000Z',
    }),
  ];
}

export function buildIncompleteMissingApprovalEvents(): ActionLogRecord[] {
  return [
    buildEvent({
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: 'rec-001',
      reasonCodes: ['COST_EVIDENCE_ATTACHED'],
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
    buildEvent({
      eventType: 'APPROVAL_REQUIRED',
      sourceStage: 'APPROVAL',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:05:00.000Z',
    }),
    buildEvent({
      eventType: 'EXECUTION_SUCCEEDED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:10:00.000Z',
    }),
  ];
}

export function buildIncompleteMissingVerificationEvents(): ActionLogRecord[] {
  return [
    buildEvent({
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: 'rec-001',
      reasonCodes: ['COST_EVIDENCE_ATTACHED'],
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
    buildEvent({
      eventType: 'APPROVAL_GRANTED',
      sourceStage: 'APPROVAL',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:05:00.000Z',
    }),
    buildEvent({
      eventType: 'EXECUTION_SUCCEEDED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT4_EXECUTION_ID,
      occurredAt: '2026-08-20T10:10:00.000Z',
    }),
  ];
}

export function buildLateArrivingActionLogEvents(): ActionLogRecord[] {
  const early = buildEvent({
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'rec-001',
    occurredAt: '2026-08-20T10:00:00.000Z',
    logicalEventId: 'early-event',
  });
  const late = buildEvent({
    eventType: 'VERIFICATION_COMPLETED',
    sourceStage: 'VERIFICATION',
    sourceRecordId: SPRINT4_EXECUTION_ID,
    occurredAt: '2026-08-20T10:20:00.000Z',
    recordedAt: '2026-08-21T10:00:00.000Z',
    logicalEventId: 'late-event',
  });
  return [late, early];
}

export function buildDuplicateActionLogEvents(): ActionLogRecord[] {
  const canonical = buildEvent({
    eventType: 'EXECUTION_SUCCEEDED',
    sourceStage: 'EXECUTION',
    sourceRecordId: SPRINT4_EXECUTION_ID,
    occurredAt: '2026-08-20T10:10:00.000Z',
    logicalEventId: 'dup-logical-id',
  });
  const duplicate = { ...canonical, recordedAt: '2026-08-21T10:00:00.000Z' };
  return [canonical, duplicate];
}

export function buildCrossTenantEvent(): ActionLogRecord {
  return prepareActionLogRecord({
    tenantId: TENANT_B,
    accountId: ACCOUNT_B,
    correlationId: SPRINT4_CORRELATION_ID,
    decisionId: SPRINT4_DECISION_ID,
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'rec-tenant-b',
    occurredAt: BASE_TIME,
  });
}

export async function seedActionLogEvents(
  repository: { recordEvent: (input: RecordActionLogEventInput) => Promise<unknown> },
  events: ActionLogRecord[],
): Promise<void> {
  for (const event of events) {
    await repository.recordEvent({
      tenantId: event.tenantId,
      accountId: event.accountId,
      resourceId: event.resourceId,
      findingKey: event.findingKey,
      decisionId: event.decisionId,
      workflowId: event.workflowId,
      jobId: event.jobId,
      correlationId: event.correlationId,
      executionId: event.executionId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      sourceStage: event.sourceStage,
      sourceRecordId: event.sourceRecordId,
      sourceRecordVersion: event.sourceRecordVersion,
      modelId: event.modelId,
      featureSchemaVersion: event.featureSchemaVersion,
      reasonCodes: event.reasonCodes,
      actorType: event.actorType,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      logicalEventId: event.logicalEventId,
    });
  }
}

function resolveVerifiedSourceAvailability(
  event: ActionLogRecord,
): ProvenanceSourceAvailability {
  if (getStageProvenanceClass(event.sourceStage) === 'ACTIONLOG_AUTHORITATIVE') {
    return 'ACTIONLOG_AUTHORITATIVE';
  }
  if (
    event.sourceStage === 'APPROVAL' ||
    event.sourceStage === 'EXECUTION' ||
    event.sourceStage === 'VERIFICATION'
  ) {
    return 'AVAILABLE';
  }
  return 'NOT_RESOLVED';
}

export function buildSourceVerifiedReferences(
  events: readonly ActionLogRecord[],
): ProvenanceSourceReference[] {
  return events.map((event) => ({
    sourceStage: event.sourceStage,
    eventType: event.eventType,
    sourceRecordId: event.sourceRecordId,
    sourceRecordVersion: event.sourceRecordVersion,
    tenantId: event.tenantId,
    accountId: event.accountId,
    occurredAt: event.occurredAt,
    logicalEventId: event.logicalEventId,
    modelId: event.modelId,
    availability: resolveVerifiedSourceAvailability(event),
  }));
}

export async function seedVerifiedExecutionSources(deps: {
  executionPlanRepository: MockExecutionPlanRepository;
  verificationRepository: MockVerificationRepository;
  tenantId: string;
  accountId: string;
  executionId: string;
  workflowId: string;
}): Promise<void> {
  await deps.executionPlanRepository.create({
    tenantId: deps.tenantId,
    executionId: deps.executionId,
    workflowId: deps.workflowId,
    recommendationId: 'rec-001',
    planStatus: 'COMPLETED',
    createdBy: 'provenance-fixture',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'RESIZE',
        resourceType: 'EC2',
        resourceId: 'i-123',
        description: 'Provenance fixture step',
      },
    ],
    rollbackPlan: { strategy: 'NONE', steps: [], automatic: false },
    riskLevel: 'LOW',
    approvalRequired: true,
    approvalStatus: 'APPROVED',
  });

  await deps.verificationRepository.save({
    tenantId: deps.tenantId,
    accountId: deps.accountId,
    workflowId: deps.workflowId,
    executionId: deps.executionId,
    expectation: {
      expectedMonthlySavings: 10,
      expectedInstanceType: 't3.medium',
      previousInstanceType: 't3.large',
      currency: 'USD',
    },
    observation: null,
    result: {
      status: VERIFICATION_STATUS.VERIFIED,
      expectedSavings: 10,
      actualSavings: 10,
      verifiedSavings: 10,
      variance: 0,
      variancePercentage: 0,
      stateMatched: true,
    },
    recordedAt: new Date().toISOString(),
  });
}
