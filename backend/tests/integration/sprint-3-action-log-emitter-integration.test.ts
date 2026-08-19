import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { ActionLogPersistenceError } from '../../action-log/errors';
import { InvalidPaginationTokenError } from '../../database';
import { ACTION_LOG_PAGINATION_SCOPES } from '../../persistence/action-log-pagination-scopes';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { ActionLogService } from '../../services/action-log-service';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import { buildRecordEvidenceObservationInput } from '../fixtures/evidence/observation-builders';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';

function createEmitterHarness() {
  const actionLogRepository = new MockActionLogRepository();
  const service = new ActionLogService(actionLogRepository);
  const emitter = new ActionLogEmitter(service);
  return { actionLogRepository, service, emitter };
}

test('emitter preserves tenant/account scope and rejects cross-tenant lifecycle mixing', async () => {
  const { service, emitter } = createEmitterHarness();
  const observations = new MockEvidenceObservationRepository();
  const persistence = new EvidencePersistenceService(observations, emitter);

  await persistence.recordObservation(
    buildRecordEvidenceObservationInput({
      identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      correlationId: 'corr-tenant-a',
      recommendationId: 'rec-a',
    }),
  );
  await persistence.recordObservation(
    buildRecordEvidenceObservationInput({
      identity: { tenantId: TENANT_B, accountId: ACCOUNT_B },
      correlationId: 'corr-tenant-b',
      recommendationId: 'rec-b',
    }),
  );

  assert.equal(
    (await service.reconstructCorrelationLifecycle(TENANT_A, 'corr-tenant-a')).items.length,
    2,
  );
  assert.equal(
    (await service.reconstructCorrelationLifecycle(TENANT_B, 'corr-tenant-a')).items.length,
    0,
  );
});

test('emitter account scope is explicit for resource reconstruction', async () => {
  const { service, emitter } = createEmitterHarness();
  const observations = new MockEvidenceObservationRepository();
  const persistence = new EvidencePersistenceService(observations, emitter);
  const input = buildRecordEvidenceObservationInput({
    identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    correlationId: 'corr-account-scope',
    recommendationId: 'rec-scope',
  });

  await persistence.recordObservation(input);

  assert.equal(
    (
      await service.reconstructResourceLifecycle(
        TENANT_A,
        ACCOUNT_A,
        input.resourceId,
      )
    ).items.length,
    2,
  );
  assert.equal(
    (
      await service.reconstructResourceLifecycle(
        TENANT_A,
        ACCOUNT_B,
        input.resourceId,
      )
    ).items.length,
    0,
  );
});

test('ActionLog persistence failure surfaces without mutating authoritative observation result', async () => {
  const observations = new MockEvidenceObservationRepository();
  const failingRepository = {
    recordEvent: async () => {
      throw new Error('dynamodb unavailable');
    },
    getEvent: async () => null,
    listByDecision: async () => ({ items: [] }),
    listByResource: async () => ({ items: [] }),
    listByCorrelation: async () => ({ items: [] }),
    listByExecution: async () => ({ items: [] }),
  };
  const emitter = new ActionLogEmitter(new ActionLogService(failingRepository));
  const persistence = new EvidencePersistenceService(observations, emitter);
  const input = buildRecordEvidenceObservationInput({
    identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    correlationId: 'corr-failure',
    recommendationId: 'rec-failure',
  });

  await assert.rejects(
    () => persistence.recordObservation(input),
    ActionLogPersistenceError,
  );

  const listed = await observations.listObservationsForFinding({
    tenantId: input.tenantId,
    accountId: input.accountId,
    findingKey: input.findingKey,
  });
  assert.equal(listed.items.length, 1);
});

test('foreign scoped pagination token is rejected at service layer', async () => {
  const { service, emitter } = createEmitterHarness();
  const observations = new MockEvidenceObservationRepository();
  const persistence = new EvidencePersistenceService(observations, emitter);
  await persistence.recordObservation(
    buildRecordEvidenceObservationInput({
      identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      correlationId: 'corr-token',
      recommendationId: 'rec-token',
    }),
  );

  const page = await service.reconstructCorrelationLifecycle(TENANT_A, 'corr-token', {
    limit: 1,
  });
  if (!page.nextToken) {
    return;
  }

  const foreignToken = page.nextToken.replace(
    ACTION_LOG_PAGINATION_SCOPES.correlationList(TENANT_A, 'corr-token'),
    ACTION_LOG_PAGINATION_SCOPES.correlationList(TENANT_B, 'corr-token'),
  );

  if (foreignToken !== page.nextToken) {
    await assert.rejects(
      () =>
        service.reconstructCorrelationLifecycle(TENANT_A, 'corr-token', {
          nextToken: foreignToken,
        }),
      InvalidPaginationTokenError,
    );
  }
});
