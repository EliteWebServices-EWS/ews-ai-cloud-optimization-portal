import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateProvenanceCompleteness } from '../../provenance-reconstruction/completeness';
import { dedupeAndOrderActionLogRecords } from '../../provenance-reconstruction/ordering';
import { PROVENANCE_REASON } from '../../provenance-reconstruction/reason-codes';
import {
  buildCompleteExecutedAndVerifiedEvents,
  buildCompleteNoMlFallbackEvents,
  buildCompleteRollbackEvents,
  buildCompleteSimulationEvents,
  buildDuplicateActionLogEvents,
  buildIncompleteMissingApprovalEvents,
  buildIncompleteMissingVerificationEvents,
  buildLateArrivingActionLogEvents,
  buildPartialMissingCostEvidenceEvents,
  buildPartialMissingLearningEvents,
  buildSourceVerifiedReferences,
} from '../fixtures/sprint-4-provenance/provenance-fixtures';

describe('Sprint 4 provenance completeness', () => {
  it('classifies COMPLETE_EXECUTED_AND_VERIFIED when required sources are verified', () => {
    const events = buildCompleteExecutedAndVerifiedEvents();
    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );
    assert.equal(result.completeness, 'COMPLETE');
    assert.ok(result.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_COMPLETE));
  });

  it('classifies COMPLETE_NO_ML_FALLBACK when required sources are verified', () => {
    const events = buildCompleteNoMlFallbackEvents();
    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );
    assert.equal(result.completeness, 'COMPLETE');
    assert.ok(result.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_ML_PATH_VALID));
  });

  it('classifies COMPLETE_SIMULATION without verification requirement', () => {
    const events = buildCompleteSimulationEvents();
    const result = evaluateProvenanceCompleteness(events, [], {
      sourceVerificationMode: 'source_verified',
    });
    assert.equal(result.completeness, 'COMPLETE');
    assert.ok(result.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_SIMULATION_PATH));
  });

  it('classifies COMPLETE_ROLLBACK contract vector as PARTIAL until durable rollback execution exists', () => {
    const events = buildCompleteRollbackEvents();
    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );
    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_ROLLBACK_MISSING),
    );
  });

  it('classifies PARTIAL_MISSING_COST_EVIDENCE', () => {
    const events = buildPartialMissingCostEvidenceEvents();
    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );
    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_OPTIONAL_COST_EVIDENCE_MISSING,
      ),
    );
  });

  it('classifies PARTIAL_MISSING_LEARNING_OUTCOME', () => {
    const events = buildPartialMissingLearningEvents();
    const result = evaluateProvenanceCompleteness(
      events,
      buildSourceVerifiedReferences(events),
      { sourceVerificationMode: 'source_verified' },
    );
    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_OPTIONAL_LEARNING_MISSING,
      ),
    );
  });

  it('classifies INCOMPLETE_MISSING_APPROVAL', () => {
    const events = buildIncompleteMissingApprovalEvents();
    const result = evaluateProvenanceCompleteness(events, [], {
      sourceVerificationMode: 'source_verified',
    });
    assert.equal(result.completeness, 'INCOMPLETE');
    assert.ok(
      result.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_APPROVAL_MISSING),
    );
  });

  it('classifies INCOMPLETE_MISSING_VERIFICATION', () => {
    const events = buildIncompleteMissingVerificationEvents();
    const result = evaluateProvenanceCompleteness(events, [], {
      sourceVerificationMode: 'source_verified',
    });
    assert.equal(result.completeness, 'INCOMPLETE');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_VERIFICATION_MISSING,
      ),
    );
  });

  it('source_verified mode blocks COMPLETE when required sources are UNAVAILABLE', () => {
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
  });
});

describe('Sprint 4 provenance ordering', () => {
  it('orders LATE_ARRIVING_ACTIONLOG by occurredAt not recordedAt', () => {
    const ordered = dedupeAndOrderActionLogRecords(buildLateArrivingActionLogEvents());
    assert.deepEqual(
      ordered.map((event) => event.logicalEventId),
      ['early-event', 'late-event'],
    );
  });

  it('deduplicates DUPLICATE_ACTIONLOG logical stages', () => {
    const ordered = dedupeAndOrderActionLogRecords(buildDuplicateActionLogEvents());
    assert.equal(ordered.length, 1);
    assert.equal(ordered[0]?.logicalEventId, 'dup-logical-id');
  });
});
