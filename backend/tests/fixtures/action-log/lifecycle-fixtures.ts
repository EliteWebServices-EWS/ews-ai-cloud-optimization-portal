import type { RecordActionLogEventInput } from '../../../action-log/types';
import { buildLogicalActionLogEventId } from '../../../action-log/event-identity';
import { buildLogicalObservationId } from '../../../persistence-intelligence/observation-ordering';
import {
  EC2_CATEGORY_STOPPED_WITH_STORAGE,
  FIXED_OBSERVATION_TS_1,
  FIXED_OBSERVATION_TS_2,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  TENANT_A,
  TENANT_B,
  ACCOUNT_A,
  ACCOUNT_B,
} from '../evidence/identities';

export const SPRINT3_CORRELATION_ID = 'corr-sprint3-golden-lifecycle';
export const SPRINT3_DECISION_ID = 'decision-sprint3-golden';
export const SPRINT3_WORKFLOW_ID = 'workflow-sprint3-golden';
export const SPRINT3_JOB_ID = 'job-sprint3-golden';
export const SPRINT3_EXECUTION_ID = 'exec-sprint3-golden';
export const SPRINT3_ANALYSIS_RUN_ID = 'analysis-run-sprint3-golden';

export const SPRINT3_FINDING_KEY =
  'ec2.cost.stopped_with_storage#i-0goldenconfidence';

export const SPRINT3_LOGICAL_OBSERVATION_ID = buildLogicalObservationId({
  tenantId: TENANT_A,
  accountId: ACCOUNT_A,
  findingKey: SPRINT3_FINDING_KEY,
  analysisRunId: SPRINT3_ANALYSIS_RUN_ID,
  observationTimestamp: FIXED_OBSERVATION_TS_1,
});

export function buildSprint3LifecycleEvents(): RecordActionLogEventInput[] {
  const base = {
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    findingKey: SPRINT3_FINDING_KEY,
    decisionId: SPRINT3_DECISION_ID,
    workflowId: SPRINT3_WORKFLOW_ID,
    jobId: SPRINT3_JOB_ID,
    correlationId: SPRINT3_CORRELATION_ID,
  };

  const observationSourceRecordId = `obs-${SPRINT3_LOGICAL_OBSERVATION_ID.slice(0, 12)}`;
  const persistenceSourceRecordId = `persist-${SPRINT3_LOGICAL_OBSERVATION_ID.slice(0, 12)}`;
  const maturitySourceRecordId = `maturity-${SPRINT3_LOGICAL_OBSERVATION_ID.slice(0, 12)}`;
  const governanceSourceRecordId = `gov-${SPRINT3_LOGICAL_OBSERVATION_ID.slice(0, 12)}`;
  const confidenceSourceRecordId = `conf-${SPRINT3_LOGICAL_OBSERVATION_ID.slice(0, 12)}`;
  const readinessSourceRecordId = `ready-${SPRINT3_LOGICAL_OBSERVATION_ID.slice(0, 12)}`;

  return [
    {
      ...base,
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: observationSourceRecordId,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_1,
      reasonCodes: [EC2_CATEGORY_STOPPED_WITH_STORAGE],
    },
    {
      ...base,
      eventType: 'PERSISTENCE_EVALUATED',
      sourceStage: 'PERSISTENCE',
      sourceRecordId: persistenceSourceRecordId,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_1,
      reasonCodes: ['STABLE'],
    },
    {
      ...base,
      eventType: 'MATURITY_EVALUATED',
      sourceStage: 'MATURITY',
      sourceRecordId: maturitySourceRecordId,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['MATURE'],
    },
    {
      ...base,
      eventType: 'GOVERNANCE_EVALUATED',
      sourceStage: 'GOVERNANCE',
      sourceRecordId: governanceSourceRecordId,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['CONVERGED'],
    },
    {
      ...base,
      eventType: 'CONFIDENCE_EVALUATED',
      sourceStage: 'CONFIDENCE',
      sourceRecordId: confidenceSourceRecordId,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['HIGH'],
    },
    {
      ...base,
      eventType: 'DECISION_READINESS_EVALUATED',
      sourceStage: 'DECISION_READINESS',
      sourceRecordId: readinessSourceRecordId,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['READY'],
    },
    {
      ...base,
      eventType: 'ML_ELIGIBILITY_EVALUATED',
      sourceStage: 'ML',
      sourceRecordId: 'ml-eligibility-fixture-v1',
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['ELIGIBLE_FIXTURE'],
    },
    {
      ...base,
      eventType: 'APPROVAL_REQUIRED',
      sourceStage: 'APPROVAL',
      sourceRecordId: 'approval-request-fixture-v1',
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['PENDING_FIXTURE'],
    },
    {
      ...base,
      executionId: SPRINT3_EXECUTION_ID,
      eventType: 'EXECUTION_STARTED',
      sourceStage: 'EXECUTION',
      sourceRecordId: SPRINT3_EXECUTION_ID,
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['STARTED_FIXTURE'],
    },
    {
      ...base,
      executionId: SPRINT3_EXECUTION_ID,
      eventType: 'VERIFICATION_STARTED',
      sourceStage: 'VERIFICATION',
      sourceRecordId: 'verification-fixture-v1',
      sourceRecordVersion: '1',
      occurredAt: FIXED_OBSERVATION_TS_2,
      reasonCodes: ['STARTED_FIXTURE'],
    },
  ];
}

export function buildForeignTenantEvent(): RecordActionLogEventInput {
  return {
    tenantId: TENANT_B,
    accountId: ACCOUNT_B,
    resourceId: 'i-foreign',
    findingKey: 'ec2.cost.foreign#i-foreign',
    correlationId: 'corr-tenant-beta',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-foreign',
    occurredAt: FIXED_OBSERVATION_TS_1,
  };
}

export function buildForeignAccountEvent(): RecordActionLogEventInput {
  return {
    tenantId: TENANT_A,
    accountId: ACCOUNT_B,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    findingKey: SPRINT3_FINDING_KEY,
    correlationId: 'corr-account-beta',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-account-foreign',
    occurredAt: FIXED_OBSERVATION_TS_1,
  };
}

export function deterministicLogicalEventId(
  input: RecordActionLogEventInput,
): string {
  return buildLogicalActionLogEventId(input);
}
