import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { resolveActionLogDecisionId } from '../../action-log/lifecycle-context';
import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import {
  buildExecutionApiSuccessRecommendationPersistsInput,
  buildPostActionInsufficientEvidenceInput,
  SPRINT3_CORRELATION_ID,
  SPRINT3_FINDING_KEY,
  SPRINT3_RECOMMENDATION_ID,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Sprint 3 verification ActionLog integration', () => {
  it('emits VERIFICATION_STARTED and VERIFICATION_COMPLETED for HEALTHY assessment', async () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const verificationRepository = new MockVerificationRepository();
    const verificationService = new PostActionVerificationService(undefined, verificationRepository);
    const actionLogRepository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(actionLogRepository));

    const { assessment } = await verificationService.evaluateAndPersist({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-actionlog-healthy',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    const events = await emitter.emitAfterPostActionVerification({
      assessment,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: fixture.executionResult.resourceId,
      findingKey: SPRINT3_FINDING_KEY,
      correlationId: SPRINT3_CORRELATION_ID,
      recommendationId: SPRINT3_RECOMMENDATION_ID,
      workflowId: 'wf-actionlog-healthy',
      executionId: fixture.executionResult.executionId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT3_CORRELATION_ID,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
      },
    });

    assert.equal(events.length, 2);
    assert.equal(events[0]?.event.eventType, 'VERIFICATION_STARTED');
    assert.equal(events[1]?.event.eventType, 'VERIFICATION_COMPLETED');
    assert.equal(events[0]?.event.tenantId, TENANT_A);
    assert.equal(events[0]?.event.accountId, ACCOUNT_A);
    assert.equal(events[0]?.event.executionId, fixture.executionResult.executionId);
    assert.equal(
      events[0]?.event.decisionId,
      resolveActionLogDecisionId({
        correlationId: SPRINT3_CORRELATION_ID,
        findingKey: SPRINT3_FINDING_KEY,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
      }),
    );
    assert.equal(events[0]?.event.sourceRecordId, assessment.assessmentId);
  });

  it('emits VERIFICATION_INSUFFICIENT_EVIDENCE when assessment outcome is insufficient', async () => {
    const fixture = buildPostActionInsufficientEvidenceInput();
    const verificationService = new PostActionVerificationService(
      undefined,
      new MockVerificationRepository(),
    );
    const emitter = new ActionLogEmitter(new ActionLogService(new MockActionLogRepository()));

    const { assessment } = await verificationService.evaluateAndPersist({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-actionlog-insufficient',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    const events = await emitter.emitAfterPostActionVerification({
      assessment,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT3_CORRELATION_ID,
      recommendationId: SPRINT3_RECOMMENDATION_ID,
      executionId: fixture.executionResult.executionId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT3_CORRELATION_ID,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
      },
    });

    assert.equal(events[1]?.event.eventType, 'VERIFICATION_INSUFFICIENT_EVIDENCE');
  });

  it('duplicate ActionLog emission remains idempotent via repository identity', async () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const verificationService = new PostActionVerificationService(
      undefined,
      new MockVerificationRepository(),
    );
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const assessment = verificationService.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-idempotent',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    const scope = {
      assessment,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT3_CORRELATION_ID,
      recommendationId: SPRINT3_RECOMMENDATION_ID,
      executionId: fixture.executionResult.executionId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT3_CORRELATION_ID,
        recommendationId: SPRINT3_RECOMMENDATION_ID,
      },
    };

    await emitter.emitAfterPostActionVerification(scope);
    await emitter.emitAfterPostActionVerification(scope);

    const stored = await repository.listByCorrelation(TENANT_A, SPRINT3_CORRELATION_ID);
    assert.equal(stored.items.length, 2);
  });
});
