import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { ActionLogPersistenceError } from '../../action-log/errors';
import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import type { ActionLogRepository } from '../../repositories/contracts';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import {
  buildExecutionApiSuccessRecommendationPersistsInput,
  SPRINT3_CORRELATION_ID,
  SPRINT3_FINDING_KEY,
  SPRINT3_RECOMMENDATION_ID,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

function createRetryableActionLogRepository(initiallyFailing: { value: boolean }) {
  const inner = new MockActionLogRepository();
  const repository: ActionLogRepository = {
    recordEvent: async (input) => {
      if (initiallyFailing.value) {
        throw new Error('dynamodb unavailable');
      }
      return inner.recordEvent(input);
    },
    getEvent: (...args) => inner.getEvent(...args),
    listByDecision: (...args) => inner.listByDecision(...args),
    listByResource: (...args) => inner.listByResource(...args),
    listByCorrelation: (...args) => inner.listByCorrelation(...args),
    listByExecution: (...args) => inner.listByExecution(...args),
  };

  return { repository, inner };
}

describe('Sprint 3 verification ActionLog persistence failure lifecycle', () => {
  it('authoritative verification persisted → ActionLog emission fails → assessment intact → retry idempotent', async () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const verificationRepository = new MockVerificationRepository();
    const verificationService = new PostActionVerificationService(undefined, verificationRepository);

    const { assessment, persisted } = await verificationService.evaluateAndPersist({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-actionlog-persist-fail',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    const beforeOutcome = persisted.assessment?.outcome;
    const beforeReasonCodes = [...(persisted.assessment?.reasonCodes ?? [])];

    const failFlag = { value: true };
    const { repository, inner } = createRetryableActionLogRepository(failFlag);
    const emitter = new ActionLogEmitter(new ActionLogService(repository));

    const emitScope = {
      assessment,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: fixture.executionResult.resourceId,
      findingKey: SPRINT3_FINDING_KEY,
      correlationId: SPRINT3_CORRELATION_ID,
      recommendationId: SPRINT3_RECOMMENDATION_ID,
      workflowId: 'wf-actionlog-persist-fail',
      executionId: fixture.executionResult.executionId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT3_CORRELATION_ID,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
      },
    };

    await assert.rejects(
      () => emitter.emitAfterPostActionVerification(emitScope),
      ActionLogPersistenceError,
    );

    const stillPersisted = await verificationRepository.findByWorkflowId(
      TENANT_A,
      'wf-actionlog-persist-fail',
    );
    assert.equal(stillPersisted?.assessment?.outcome, beforeOutcome);
    assert.deepEqual(stillPersisted?.assessment?.reasonCodes, beforeReasonCodes);

    const reEvaluated = verificationService.evaluate({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-actionlog-persist-fail',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });
    assert.equal(reEvaluated.outcome, assessment.outcome);
    assert.deepEqual(reEvaluated.reasonCodes, assessment.reasonCodes);

    failFlag.value = false;
    const firstRetry = await emitter.emitAfterPostActionVerification(emitScope);
    const secondRetry = await emitter.emitAfterPostActionVerification(emitScope);

    assert.equal(firstRetry.length, 2);
    assert.equal(secondRetry.length, 2);
    assert.equal(firstRetry[0]?.created, true);
    assert.equal(firstRetry[1]?.created, true);
    assert.equal(secondRetry[0]?.created, false);
    assert.equal(secondRetry[1]?.created, false);

    const stored = await inner.listByCorrelation(TENANT_A, SPRINT3_CORRELATION_ID);
    assert.equal(stored.items.length, 2);
    assert.equal(
      stored.items.filter((event) => event.eventType === 'VERIFICATION_STARTED').length,
      1,
    );
    assert.equal(
      stored.items.filter((event) => event.eventType === 'VERIFICATION_COMPLETED').length,
      1,
    );
  });
});
