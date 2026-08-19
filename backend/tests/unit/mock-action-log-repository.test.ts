import assert from 'node:assert/strict';
import test from 'node:test';

import { InvalidPaginationTokenError } from '../../database';
import { prepareActionLogRecord } from '../../action-log/record-builder';
import { ActionLogValidationError } from '../../action-log/types';
import { ACTION_LOG_PAGINATION_SCOPES } from '../../persistence/action-log-pagination-scopes';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  FIXED_OBSERVATION_TS_1,
  FIXED_OBSERVATION_TS_2,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';
import {
  SPRINT3_CORRELATION_ID,
  SPRINT3_DECISION_ID,
  SPRINT3_EXECUTION_ID,
  buildSprint3LifecycleEvents,
} from '../fixtures/action-log/lifecycle-fixtures';

function createHarness() {
  const repository = new MockActionLogRepository();
  const service = new ActionLogService(repository);
  return { repository, service };
}

test('first and second different events append', async () => {
  const { service } = createHarness();
  const first = await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-1',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-1',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });
  const second = await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-1',
    eventType: 'PERSISTENCE_EVALUATED',
    sourceStage: 'PERSISTENCE',
    sourceRecordId: 'persist-1',
    occurredAt: FIXED_OBSERVATION_TS_2,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.event.logicalEventId, second.event.logicalEventId);
});

test('duplicate lifecycle event is idempotent', async () => {
  const { service } = createHarness();
  const input = {
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-dup',
    eventType: 'GOVERNANCE_EVALUATED' as const,
    sourceStage: 'GOVERNANCE' as const,
    sourceRecordId: 'gov-1',
    sourceRecordVersion: '1',
    occurredAt: FIXED_OBSERVATION_TS_1,
  };

  const first = await service.recordEvent(input);
  const duplicate = await service.recordEvent(input);

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.event.logicalEventId, duplicate.event.logicalEventId);
  assert.equal(first.event.sourceRecordId, duplicate.event.sourceRecordId);
  assert.equal(first.event.sourceRecordVersion, duplicate.event.sourceRecordVersion);
});

test('same timestamp events remain deterministically ordered', async () => {
  const { service } = createHarness();
  const sharedOccurredAt = FIXED_OBSERVATION_TS_1;

  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-same-ts',
    decisionId: SPRINT3_DECISION_ID,
    eventType: 'MATURITY_EVALUATED',
    sourceStage: 'MATURITY',
    sourceRecordId: 'maturity-z',
    sourceRecordVersion: '1',
    occurredAt: sharedOccurredAt,
  });
  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-same-ts',
    decisionId: SPRINT3_DECISION_ID,
    eventType: 'PERSISTENCE_EVALUATED',
    sourceStage: 'PERSISTENCE',
    sourceRecordId: 'persist-a',
    sourceRecordVersion: '1',
    occurredAt: sharedOccurredAt,
  });

  const page = await service.reconstructDecisionLifecycle(
    TENANT_A,
    SPRINT3_DECISION_ID,
  );
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.eventType, 'MATURITY_EVALUATED');
  assert.equal(page.items[1]?.eventType, 'PERSISTENCE_EVALUATED');
});

test('late-arriving event appends without rewriting earlier rows', async () => {
  const { service } = createHarness();

  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-late',
    eventType: 'EXECUTION_SUCCEEDED',
    sourceStage: 'EXECUTION',
    sourceRecordId: 'exec-1',
    executionId: SPRINT3_EXECUTION_ID,
    occurredAt: FIXED_OBSERVATION_TS_2,
    recordedAt: '2026-08-12T12:00:00.000Z',
  });
  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-late',
    eventType: 'PERSISTENCE_EVALUATED',
    sourceStage: 'PERSISTENCE',
    sourceRecordId: 'persist-late',
    occurredAt: FIXED_OBSERVATION_TS_1,
    recordedAt: '2026-08-13T12:00:00.000Z',
  });

  const page = await service.reconstructCorrelationLifecycle(TENANT_A, 'corr-late');
  assert.deepEqual(
    page.items.map((item) => item.eventType),
    ['PERSISTENCE_EVALUATED', 'EXECUTION_SUCCEEDED'],
  );
});

test('bounded pagination and continuation', async () => {
  const { service } = createHarness();
  for (let index = 0; index < 3; index += 1) {
    await service.recordEvent({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
      correlationId: 'corr-page',
      eventType: 'RECOMMENDATION_OBSERVED',
      sourceStage: 'RECOMMENDATION',
      sourceRecordId: `obs-${index}`,
      occurredAt: `2026-08-1${index}T12:00:00.000Z`,
    });
  }

  const firstPage = await service.reconstructResourceLifecycle(
    TENANT_A,
    ACCOUNT_A,
    RESOURCE_ID_CONFIDENCE_GOLDEN,
    { limit: 2 },
  );
  assert.equal(firstPage.items.length, 2);
  assert.ok(firstPage.nextToken);

  const secondPage = await service.reconstructResourceLifecycle(
    TENANT_A,
    ACCOUNT_A,
    RESOURCE_ID_CONFIDENCE_GOLDEN,
    { limit: 2, nextToken: firstPage.nextToken },
  );
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.nextToken, undefined);
});

test('tenant and account isolation across query paths', async () => {
  const { service } = createHarness();

  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    correlationId: 'corr-tenant-a',
    decisionId: 'decision-a',
    executionId: 'exec-a',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-a',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });
  await service.recordEvent({
    tenantId: TENANT_B,
    accountId: ACCOUNT_B,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    correlationId: 'corr-tenant-b',
    decisionId: 'decision-b',
    executionId: 'exec-b',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-b',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });
  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_B,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    correlationId: 'corr-account-b',
    decisionId: 'decision-account-b',
    executionId: 'exec-account-b',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-account-b',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });

  assert.equal(
    (await service.reconstructCorrelationLifecycle(TENANT_A, 'corr-tenant-a')).items.length,
    1,
  );
  assert.equal(
    (await service.reconstructCorrelationLifecycle(TENANT_B, 'corr-tenant-b')).items.length,
    1,
  );
  assert.equal(
    (
      await service.reconstructResourceLifecycle(
        TENANT_A,
        ACCOUNT_A,
        RESOURCE_ID_CONFIDENCE_GOLDEN,
      )
    ).items.length,
    1,
  );
  assert.equal(
    (
      await service.reconstructResourceLifecycle(
        TENANT_A,
        ACCOUNT_B,
        RESOURCE_ID_CONFIDENCE_GOLDEN,
      )
    ).items.length,
    1,
  );
});

test('foreign tenant pagination token is rejected', async () => {
  const { service } = createHarness();
  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-token',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-token',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });

  const page = await service.reconstructCorrelationLifecycle(TENANT_A, 'corr-token', {
    limit: 1,
  });
  const foreignScopeToken = page.nextToken?.replace(
    ACTION_LOG_PAGINATION_SCOPES.correlationList(TENANT_A, 'corr-token'),
    ACTION_LOG_PAGINATION_SCOPES.correlationList(TENANT_B, 'corr-token'),
  );

  if (foreignScopeToken && foreignScopeToken !== page.nextToken) {
    await assert.rejects(
      () =>
        service.reconstructCorrelationLifecycle(TENANT_A, 'corr-token', {
          nextToken: foreignScopeToken,
        }),
      InvalidPaginationTokenError,
    );
  }
});

test('malformed event rejected', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () =>
      service.recordEvent({
        tenantId: TENANT_A,
        correlationId: '',
        eventType: 'RECOMMENDATION_OBSERVED',
        sourceStage: 'RECOMMENDATION',
        sourceRecordId: 'obs-invalid',
        occurredAt: FIXED_OBSERVATION_TS_1,
      }),
    ActionLogValidationError,
  );
});

test('correlationId preserved across sprint3 lifecycle fixture', async () => {
  const { service } = createHarness();
  for (const event of buildSprint3LifecycleEvents()) {
    await service.recordEvent(event);
  }

  const page = await service.reconstructCorrelationLifecycle(
    TENANT_A,
    SPRINT3_CORRELATION_ID,
  );
  assert.equal(page.items.length, 10);
  assert.ok(page.items.every((item) => item.correlationId === SPRINT3_CORRELATION_ID));
  assert.ok(page.items.every((item) => item.sourceRecordId.length > 0));
});

test('source references cannot overwrite prior event', async () => {
  const { service } = createHarness();
  const input = {
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-no-overwrite',
    eventType: 'CONFIDENCE_EVALUATED' as const,
    sourceStage: 'CONFIDENCE' as const,
    sourceRecordId: 'conf-original',
    sourceRecordVersion: '1',
    occurredAt: FIXED_OBSERVATION_TS_1,
  };

  const first = await service.recordEvent(input);
  const retryWithDifferentReason = await service.recordEvent({
    ...input,
    reasonCodes: ['LOW'],
  });

  assert.equal(retryWithDifferentReason.created, false);
  assert.equal(retryWithDifferentReason.event.sourceRecordId, 'conf-original');
  assert.equal(
    retryWithDifferentReason.event.logicalEventId,
    first.event.logicalEventId,
  );
});

test('execution reconstruction path', async () => {
  const { service } = createHarness();
  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-exec',
    executionId: SPRINT3_EXECUTION_ID,
    eventType: 'EXECUTION_STARTED',
    sourceStage: 'EXECUTION',
    sourceRecordId: SPRINT3_EXECUTION_ID,
    occurredAt: FIXED_OBSERVATION_TS_1,
  });

  const page = await service.reconstructExecutionLifecycle(
    TENANT_A,
    SPRINT3_EXECUTION_ID,
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.executionId, SPRINT3_EXECUTION_ID);
});

test('getEvent returns canonical row', async () => {
  const { service } = createHarness();
  const recorded = await service.recordEvent({
    tenantId: TENANT_A,
    correlationId: 'corr-get',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-get',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });

  const fetched = await service.getEvent(
    TENANT_A,
    recorded.event.logicalEventId,
  );
  assert.deepEqual(fetched, recorded.event);
});

test('prepareActionLogRecord exposes stable order key', () => {
  const record = prepareActionLogRecord({
    tenantId: TENANT_A,
    correlationId: 'corr-order-key',
    eventType: 'GOVERNANCE_EVALUATED',
    sourceStage: 'GOVERNANCE',
    sourceRecordId: 'gov-1',
    sourceRecordVersion: '2',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });
  assert.equal(record.orderKey, 'GOVERNANCE#gov-1#2');
});
