import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { prepareActionLogRecord } from '../../action-log/record-builder';
import { resolveLogicalActionLogEventId } from '../../action-log/event-identity';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { DecisionProvenanceReconstructionService } from '../../services/decision-provenance-reconstruction-service';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import { buildMlDecisionEvaluateInput } from '../fixtures/evidence/ml-fixtures';
import {
  SPRINT4_CORRELATION_ID,
  SPRINT4_DECISION_ID,
  seedActionLogEvents,
} from '../fixtures/sprint-4-provenance/provenance-fixtures';

describe('Sprint 4 ML ActionLog modelId provenance', () => {
  it('persists modelId on the structured ActionLog field, not in reasonCodes', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const evaluateInput = buildMlDecisionEvaluateInput();
    const { decision } = await service.evaluate(evaluateInput);

    const events = await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: evaluateInput.correlationId,
      recommendationId: evaluateInput.recommendationId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: evaluateInput.correlationId,
        recommendationId: evaluateInput.recommendationId,
      },
    });

    const outcome = events[1]?.event;
    assert.equal(outcome?.modelId, decision.modelId);
    assert.ok(outcome?.modelId);
    assert.ok(
      !outcome?.reasonCodes?.some((code) => code.startsWith('ML_MODEL:')),
    );
  });

  it('reconstructs ML provenance including modelId from durable ActionLog events', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const reconstruction = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const evaluateInput = buildMlDecisionEvaluateInput();
    const { decision } = await service.evaluate(evaluateInput);

    await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: SPRINT4_CORRELATION_ID,
      recommendationId: evaluateInput.recommendationId,
      decisionId: SPRINT4_DECISION_ID,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT4_CORRELATION_ID,
        recommendationId: evaluateInput.recommendationId,
      },
    });

    const result = await reconstruction.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
    });

    assert.ok(result.mlProvenance);
    assert.equal(result.mlProvenance?.evaluationId, decision.evaluationId);
    assert.equal(result.mlProvenance?.modelId, decision.modelId);
    assert.equal(result.mlProvenance?.modelVersion, decision.modelVersion);
    assert.equal(
      result.mlProvenance?.eligibilityPolicyVersion,
      decision.eligibilityPolicyVersion,
    );
    assert.equal(result.mlProvenance?.outcome, decision.outcome);
    assert.equal(result.mlProvenance?.fallback, decision.fallback);
  });

  it('remains backward compatible when legacy ActionLog rows omit modelId', async () => {
    const legacyOutcome = prepareActionLogRecord({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
      decisionId: SPRINT4_DECISION_ID,
      eventType: 'ML_EXECUTED',
      sourceStage: 'ML',
      sourceRecordId: 'ml-legacy-eval',
      sourceRecordVersion: 'mock-model-v1',
      occurredAt: '2026-08-20T10:05:00.000Z',
      reasonCodes: ['EXECUTED', 'NONE', 'ML_EXECUTED_SUCCESS'],
    });

    assert.equal(legacyOutcome.modelId, undefined);

    const repository = new MockActionLogRepository();
    await seedActionLogEvents(repository, [legacyOutcome]);

    const result = await new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    ).reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });

    assert.equal(result.mlProvenance?.evaluationId, 'ml-legacy-eval');
    assert.equal(result.mlProvenance?.modelId, undefined);
    assert.equal(result.mlProvenance?.modelVersion, 'mock-model-v1');
  });

  it('does not change logical event identity when modelId is present', () => {
    const baseInput = {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: 'corr-ml-identity',
      eventType: 'ML_EXECUTED' as const,
      sourceStage: 'ML' as const,
      sourceRecordId: 'eval-identity',
      sourceRecordVersion: 'mock-model-v1',
      occurredAt: '2026-08-20T10:05:00.000Z',
      reasonCodes: ['EXECUTED', 'NONE'],
    };

    const withoutModelId = resolveLogicalActionLogEventId(baseInput);
    const withModelId = resolveLogicalActionLogEventId({
      ...baseInput,
      modelId: 'mock-model',
    });

    assert.equal(withoutModelId, withModelId);
  });
});
