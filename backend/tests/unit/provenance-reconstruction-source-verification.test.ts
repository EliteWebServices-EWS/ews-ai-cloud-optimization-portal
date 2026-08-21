import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateProvenanceCompleteness } from '../../provenance-reconstruction/completeness';
import { extractMlProvenance } from '../../provenance-reconstruction/ml-provenance';
import { PROVENANCE_REASON } from '../../provenance-reconstruction/reason-codes';
import { resolveSourceReferences } from '../../provenance-reconstruction/source-reference';
import {
  STAGE_PROVENANCE_CLASS,
  getStageProvenanceClass,
} from '../../provenance-reconstruction/stage-provenance';
import { ActionLogService } from '../../services/action-log-service';
import { DecisionProvenanceReconstructionService } from '../../services/decision-provenance-reconstruction-service';
import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { MockExecutionPlanRepository } from '../../repositories/mock/mock-execution-plan-repository';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import {
  buildCompleteExecutedAndVerifiedEvents,
  buildCompleteNoMlFallbackEvents,
  buildSourceVerifiedReferences,
  seedActionLogEvents,
  seedVerifiedExecutionSources,
  SPRINT4_CORRELATION_ID,
  SPRINT4_DECISION_ID,
  SPRINT4_EXECUTION_ID,
  SPRINT4_WORKFLOW_ID,
} from '../fixtures/sprint-4-provenance/provenance-fixtures';

describe('Sprint 4 source-verified provenance reconstruction', () => {
  it('blocks authoritative COMPLETE when required pointer-only stage is NOT_RESOLVED', () => {
    const events = buildCompleteExecutedAndVerifiedEvents();
    const sourceReferences = events.map((event) => ({
      sourceStage: event.sourceStage,
      eventType: event.eventType,
      sourceRecordId: event.sourceRecordId,
      sourceRecordVersion: event.sourceRecordVersion,
      tenantId: event.tenantId,
      accountId: event.accountId,
      occurredAt: event.occurredAt,
      logicalEventId: event.logicalEventId,
      availability:
        event.sourceStage === 'ML'
          ? ('ACTIONLOG_AUTHORITATIVE' as const)
          : ('NOT_RESOLVED' as const),
    }));

    const result = evaluateProvenanceCompleteness(events, sourceReferences, {
      sourceVerificationMode: 'source_verified',
    });

    assert.notEqual(result.completeness, 'COMPLETE');
    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_NOT_VERIFIED,
      ),
    );
  });

  it('allows authoritative COMPLETE when required pointer-only stages are AVAILABLE', () => {
    const events = buildCompleteExecutedAndVerifiedEvents();
    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );

    assert.equal(result.completeness, 'COMPLETE');
    assert.ok(result.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_COMPLETE));
  });

  it('degrades with PROVENANCE_SOURCE_RECORD_UNAVAILABLE when required source lookup fails', () => {
    const events = buildCompleteExecutedAndVerifiedEvents();
    const sourceReferences = events.map((event) => ({
      sourceStage: event.sourceStage,
      eventType: event.eventType,
      sourceRecordId: event.sourceRecordId,
      sourceRecordVersion: event.sourceRecordVersion,
      tenantId: event.tenantId,
      accountId: event.accountId,
      occurredAt: event.occurredAt,
      logicalEventId: event.logicalEventId,
      availability:
        event.sourceStage === 'ML'
          ? ('ACTIONLOG_AUTHORITATIVE' as const)
          : event.sourceStage === 'APPROVAL' ||
              event.sourceStage === 'EXECUTION' ||
              event.sourceStage === 'VERIFICATION'
            ? ('UNAVAILABLE' as const)
            : ('NOT_RESOLVED' as const),
    }));

    const result = evaluateProvenanceCompleteness(events, sourceReferences, {
      sourceVerificationMode: 'source_verified',
    });

    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_UNAVAILABLE,
      ),
    );
    assert.ok(
      !result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_NOT_VERIFIED,
      ),
    );
  });

  it('reconstructs ActionLog-authoritative ML provenance without a separate ML table', async () => {
    const events = buildCompleteNoMlFallbackEvents();
    const sourceReferences = await resolveSourceReferences(
      events,
      { tenantId: TENANT_A, accountId: ACCOUNT_A },
      {},
    );

    const mlReferences = sourceReferences.filter(
      (reference) => reference.sourceStage === 'ML',
    );
    assert.ok(mlReferences.length > 0);
    assert.ok(
      mlReferences.every(
        (reference) => reference.availability === 'ACTIONLOG_AUTHORITATIVE',
      ),
    );

    const mlProvenance = extractMlProvenance(events);
    assert.ok(mlProvenance);
    assert.equal(mlProvenance.outcome, 'ML_FAILED_SAFE');

    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );
    assert.equal(result.completeness, 'COMPLETE');
  });

  it('keeps legacy ActionLog-only rows compatible via actionlog_lifecycle_diagnostic mode', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    await seedActionLogEvents(repository, buildCompleteExecutedAndVerifiedEvents());

    const result = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
      sourceVerificationMode: 'actionlog_lifecycle_diagnostic',
    });

    assert.equal(result.sourceVerificationMode, 'actionlog_lifecycle_diagnostic');
    assert.equal(result.completeness, 'COMPLETE');
    assert.ok(result.orderedEvents.length >= 5);
  });

  it('preserves tenant and account isolation semantics', async () => {
    const repository = new MockActionLogRepository();
    const executionPlanRepository = new MockExecutionPlanRepository();
    const verificationRepository = new MockVerificationRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
      { executionPlanRepository, verificationRepository },
    );

    await seedActionLogEvents(repository, buildCompleteExecutedAndVerifiedEvents());
    await seedVerifiedExecutionSources({
      executionPlanRepository,
      verificationRepository,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      executionId: SPRINT4_EXECUTION_ID,
      workflowId: SPRINT4_WORKFLOW_ID,
    });

    const result = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
    });

    assert.equal(result.completeness, 'COMPLETE');
    assert.ok(
      result.sourceReferences
        .filter((reference) =>
          ['APPROVAL', 'EXECUTION', 'VERIFICATION'].includes(reference.sourceStage),
        )
        .every((reference) => reference.availability === 'AVAILABLE'),
    );
  });

  it('documents stage provenance classification for material lifecycle stages', () => {
    assert.equal(getStageProvenanceClass('RECOMMENDATION'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('PERSISTENCE'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('MATURITY'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('GOVERNANCE'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('CONFIDENCE'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('DECISION_READINESS'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('ML'), 'ACTIONLOG_AUTHORITATIVE');
    assert.equal(getStageProvenanceClass('APPROVAL'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('EXECUTION'), 'REFERENCE_ONLY');
    assert.equal(getStageProvenanceClass('VERIFICATION'), 'REFERENCE_ONLY');
    assert.equal(STAGE_PROVENANCE_CLASS.ML, 'ACTIONLOG_AUTHORITATIVE');
  });
});
