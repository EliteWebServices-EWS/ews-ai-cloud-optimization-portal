import assert from 'node:assert/strict';
import test from 'node:test';

import { InvalidPaginationTokenError } from '../../database';
import { ACTION_LOG_PAGINATION_SCOPES } from '../../persistence/action-log-pagination-scopes';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  FIXED_OBSERVATION_TS_1,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';
import {
  buildForeignAccountEvent,
  buildForeignTenantEvent,
} from '../fixtures/action-log/lifecycle-fixtures';

test('tenant A action log never appears in tenant B queries', async () => {
  const service = new ActionLogService(new MockActionLogRepository());

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
  await service.recordEvent(buildForeignTenantEvent());

  assert.equal(
    (await service.reconstructCorrelationLifecycle(TENANT_B, 'corr-tenant-a')).items.length,
    0,
  );
  assert.equal(
    (await service.reconstructDecisionLifecycle(TENANT_B, 'decision-a')).items.length,
    0,
  );
  assert.equal(
    (await service.reconstructExecutionLifecycle(TENANT_B, 'exec-a')).items.length,
    0,
  );
});

test('tenant A account A never appears in tenant A account B resource queries', async () => {
  const service = new ActionLogService(new MockActionLogRepository());

  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    correlationId: 'corr-account-a',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-account-a',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });
  await service.recordEvent(buildForeignAccountEvent());

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

test('foreign account pagination token rejected for tenant A resource query', async () => {
  const service = new ActionLogService(new MockActionLogRepository());

  await service.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    correlationId: 'corr-token-account',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-token-account',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });

  const page = await service.reconstructResourceLifecycle(
    TENANT_A,
    ACCOUNT_A,
    RESOURCE_ID_CONFIDENCE_GOLDEN,
    { limit: 1 },
  );

  if (page.nextToken) {
    const foreignToken = page.nextToken.replace(
      ACTION_LOG_PAGINATION_SCOPES.resourceList(
        TENANT_A,
        ACCOUNT_A,
        RESOURCE_ID_CONFIDENCE_GOLDEN,
      ),
      ACTION_LOG_PAGINATION_SCOPES.resourceList(
        TENANT_A,
        ACCOUNT_B,
        RESOURCE_ID_CONFIDENCE_GOLDEN,
      ),
    );

    if (foreignToken !== page.nextToken) {
      await assert.rejects(
        () =>
          service.reconstructResourceLifecycle(
            TENANT_A,
            ACCOUNT_A,
            RESOURCE_ID_CONFIDENCE_GOLDEN,
            { nextToken: foreignToken },
          ),
        InvalidPaginationTokenError,
      );
    }
  }
});
