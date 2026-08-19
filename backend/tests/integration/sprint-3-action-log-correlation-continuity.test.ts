import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionLogService } from '../../services/action-log-service';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { TENANT_A } from '../fixtures/evidence/identities';
import {
  SPRINT3_CORRELATION_ID,
  SPRINT3_DECISION_ID,
  SPRINT3_EXECUTION_ID,
  SPRINT3_LOGICAL_OBSERVATION_ID,
  buildSprint3LifecycleEvents,
} from '../fixtures/action-log/lifecycle-fixtures';

test('correlation continuity across sprint 1/2 identities and sprint 3 fixtures', async () => {
  const service = new ActionLogService(new MockActionLogRepository());
  const recorded = [];

  for (const event of buildSprint3LifecycleEvents()) {
    recorded.push(await service.recordEvent(event));
  }

  assert.equal(recorded.length, 10);
  assert.ok(recorded.every((entry) => entry.created));

  const correlationPage = await service.reconstructCorrelationLifecycle(
    TENANT_A,
    SPRINT3_CORRELATION_ID,
  );
  assert.equal(correlationPage.items.length, 10);
  assert.ok(
    correlationPage.items.every(
      (item) => item.correlationId === SPRINT3_CORRELATION_ID,
    ),
  );

  const decisionPage = await service.reconstructDecisionLifecycle(
    TENANT_A,
    SPRINT3_DECISION_ID,
  );
  assert.equal(decisionPage.items.length, 10);

  const executionPage = await service.reconstructExecutionLifecycle(
    TENANT_A,
    SPRINT3_EXECUTION_ID,
  );
  assert.equal(executionPage.items.length, 2);

  const observationEvent = correlationPage.items.find(
    (item) => item.eventType === 'RECOMMENDATION_OBSERVED',
  );
  assert.ok(observationEvent);
  assert.match(observationEvent.sourceRecordId, /^obs-/);
  assert.ok(SPRINT3_LOGICAL_OBSERVATION_ID.length > 0);

  const readinessEvent = correlationPage.items.find(
    (item) => item.eventType === 'DECISION_READINESS_EVALUATED',
  );
  assert.ok(readinessEvent);
  assert.equal(readinessEvent.sourceStage, 'DECISION_READINESS');

  const mlEvent = correlationPage.items.find(
    (item) => item.eventType === 'ML_ELIGIBILITY_EVALUATED',
  );
  assert.ok(mlEvent);
  assert.equal(mlEvent.sourceStage, 'ML');

  const approvalEvent = correlationPage.items.find(
    (item) => item.eventType === 'APPROVAL_REQUIRED',
  );
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.sourceStage, 'APPROVAL');

  const verificationEvent = correlationPage.items.find(
    (item) => item.eventType === 'VERIFICATION_STARTED',
  );
  assert.ok(verificationEvent);
  assert.equal(verificationEvent.sourceStage, 'VERIFICATION');
});
