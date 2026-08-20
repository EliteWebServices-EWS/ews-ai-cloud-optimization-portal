import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { resolveActionLogDecisionId } from '../../action-log/lifecycle-context';
import type { RecordActionLogEventResult } from '../../action-log/types';
import {
  MockMlInferenceAdapter,
  UnavailableMlInferenceAdapter,
} from '../../ml-decision/adapters/mock-ml-inference-adapter';
import type { MLDecision } from '../../ml-decision/types';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import {
  ACCOUNT_A,
  TENANT_A,
} from '../fixtures/evidence/identities';
import {
  buildMlDecisionEvaluateInput,
  buildMlNoMlGoldenPathInput,
} from '../fixtures/evidence/ml-fixtures';

function assertMlOutcomeActionLogFields(input: {
  events: RecordActionLogEventResult[];
  expectedOutcomeEventType: 'ML_EXECUTED' | 'ML_SKIPPED' | 'ML_FAILED_SAFE';
  decision: MLDecision;
  tenantId: string;
  accountId: string;
  resourceId: string;
  findingKey: string;
  correlationId: string;
  recommendationId: string;
}) {
  assert.equal(input.events.length, 2);

  const eligibility = input.events[0]?.event;
  const outcome = input.events[1]?.event;
  const expectedDecisionId = resolveActionLogDecisionId({
    correlationId: input.correlationId,
    findingKey: input.findingKey,
    recommendationId: input.recommendationId,
  });

  assert.equal(eligibility?.eventType, 'ML_ELIGIBILITY_EVALUATED');
  assert.equal(outcome?.eventType, input.expectedOutcomeEventType);
  assert.equal(eligibility?.tenantId, input.tenantId);
  assert.equal(eligibility?.accountId, input.accountId);
  assert.equal(eligibility?.resourceId, input.resourceId);
  assert.equal(eligibility?.findingKey, input.findingKey);
  assert.equal(eligibility?.correlationId, input.correlationId);
  assert.equal(eligibility?.decisionId, expectedDecisionId);
  assert.equal(eligibility?.sourceRecordId, input.decision.evaluationId);
  assert.equal(eligibility?.sourceRecordVersion, input.decision.eligibilityPolicyVersion);
  assert.equal(eligibility?.occurredAt, input.decision.evaluatedAt);
  assert.ok(eligibility?.reasonCodes?.includes(input.decision.eligibility));

  assert.equal(outcome?.tenantId, input.tenantId);
  assert.equal(outcome?.accountId, input.accountId);
  assert.equal(outcome?.resourceId, input.resourceId);
  assert.equal(outcome?.findingKey, input.findingKey);
  assert.equal(outcome?.correlationId, input.correlationId);
  assert.equal(outcome?.decisionId, expectedDecisionId);
  assert.equal(outcome?.sourceRecordId, input.decision.evaluationId);
  assert.equal(
    outcome?.sourceRecordVersion,
    input.decision.modelVersion ?? input.decision.evaluationId,
  );
  assert.equal(
    outcome?.occurredAt,
    input.decision.inferredAt ?? input.decision.evaluatedAt,
  );
  assert.ok(outcome?.reasonCodes?.includes(input.decision.outcome));
  assert.ok(outcome?.reasonCodes?.includes(input.decision.fallback));
}

describe('Sprint 3 ML ActionLog integration', () => {
  async function emitDecision(decision: MLDecision, evaluateInput: ReturnType<typeof buildMlDecisionEvaluateInput>) {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
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

    return { events, evaluateInput };
  }

  it('maps EXECUTED to ML_EXECUTED with durable scope and provenance fields', async () => {
    const evaluateInput = buildMlDecisionEvaluateInput();
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const { decision } = await service.evaluate(evaluateInput);
    const { events } = await emitDecision(decision, evaluateInput);

    assertMlOutcomeActionLogFields({
      events,
      expectedOutcomeEventType: 'ML_EXECUTED',
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: evaluateInput.correlationId,
      recommendationId: evaluateInput.recommendationId,
    });
  });

  it('maps SKIPPED to ML_SKIPPED with durable scope and provenance fields', async () => {
    const evaluateInput = buildMlDecisionEvaluateInput();
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.2 }));
    const { decision } = await service.evaluate(evaluateInput);
    const { events } = await emitDecision(decision, evaluateInput);

    assertMlOutcomeActionLogFields({
      events,
      expectedOutcomeEventType: 'ML_SKIPPED',
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: evaluateInput.correlationId,
      recommendationId: evaluateInput.recommendationId,
    });
  });

  it('maps FAILED_SAFE to ML_FAILED_SAFE with durable scope and provenance fields', async () => {
    const evaluateInput = buildMlNoMlGoldenPathInput();
    const service = new MlDecisionService(new UnavailableMlInferenceAdapter());
    const { decision } = await service.evaluate(evaluateInput);
    const { events } = await emitDecision(decision, evaluateInput);

    assertMlOutcomeActionLogFields({
      events,
      expectedOutcomeEventType: 'ML_FAILED_SAFE',
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: evaluateInput.correlationId,
      recommendationId: evaluateInput.recommendationId,
    });
  });

  it('duplicate ML ActionLog emission is idempotent for all outcome events', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const service = new MlDecisionService(new UnavailableMlInferenceAdapter());
    const input = buildMlNoMlGoldenPathInput();
    const { decision } = await service.evaluate(input);
    const payload = {
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: input.resourceId,
      findingKey: input.findingKey,
      correlationId: input.correlationId,
      recommendationId: input.recommendationId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: input.correlationId,
        recommendationId: input.recommendationId,
      },
    };

    const first = await emitter.emitAfterMlDecision(payload);
    const second = await emitter.emitAfterMlDecision(payload);

    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.equal(first[0]?.created, true);
    assert.equal(first[1]?.created, true);
    assert.equal(second[0]?.created, false);
    assert.equal(second[1]?.created, false);
    assert.equal(first[0]?.event.logicalEventId, second[0]?.event.logicalEventId);
    assert.equal(first[1]?.event.logicalEventId, second[1]?.event.logicalEventId);
  });
});
