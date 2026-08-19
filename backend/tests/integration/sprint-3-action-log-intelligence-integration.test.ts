import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { buildGovernanceEvaluatedEventInput } from '../../action-log/stage-adapters';
import { DecisionReadinessService } from '../../decision-readiness/decision-readiness-service';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { ActionLogService } from '../../services/action-log-service';
import { EvidenceMaturityService } from '../../services/evidence-maturity-service';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import {
  buildGovernancePreservedContext,
  buildHighConfidenceMatureEvidenceInput,
  buildMatureStablePersistenceScenario,
} from '../fixtures/evidence';
import { buildAssessInputFromPipeline } from './sprint-2-decision-readiness-helpers';

const CORRELATION_ID = 'corr-sprint3-real-lifecycle';

test('real Sprint 1/2 services emit bounded ActionLog lifecycle with shared correlationId', async () => {
  const observations = new MockEvidenceObservationRepository();
  const maturityRepo = new MockEvidenceMaturityRepository();
  const actionLogRepository = new MockActionLogRepository();
  const actionLogService = new ActionLogService(actionLogRepository);
  const emitter = new ActionLogEmitter(actionLogService);

  const persistence = new EvidencePersistenceService(observations, emitter);
  const maturity = new EvidenceMaturityService(
    maturityRepo,
    observations,
    emitter,
  );
  const readiness = new DecisionReadinessService(
    observations,
    maturityRepo,
    emitter,
  );

  const scenario = buildMatureStablePersistenceScenario();
  let lastRecorded = null as Awaited<ReturnType<typeof persistence.recordObservation>> | null;

  for (const observationInput of scenario.inputs) {
    lastRecorded = await persistence.recordObservation({
      ...observationInput,
      correlationId: CORRELATION_ID,
    });
  }

  assert.ok(lastRecorded);
  const lastInput = scenario.inputs[scenario.inputs.length - 1]!;

  await maturity.evaluateAndPersist({
    observation: lastRecorded.observation,
    evaluatedAt: lastInput.observationTimestamp,
    actionLogContext: {
      tenantId: lastInput.tenantId,
      accountId: lastInput.accountId,
      correlationId: CORRELATION_ID,
      recommendationId: lastInput.recommendationId,
      jobId: lastInput.jobId,
    },
  });

  await emitter.emitAfterGovernanceResult({
    result: {
      resultId: 'gov-result-fixture-1',
      tenantId: lastInput.tenantId,
      accountId: lastInput.accountId,
      region: lastInput.region,
      resourceType: 'INSTANCE',
      resourceId: lastInput.resourceId,
      check: 'unrestricted_ssh',
      findingKey: lastInput.findingKey,
      analysisRunId: lastInput.analysisRunId,
      evaluatedAt: lastInput.observationTimestamp,
      ruleVersion: '1.0.0',
      state: 'PRESERVED',
      reasonCodes: [],
      persistedAt: lastInput.observationTimestamp,
      version: 1,
    },
    context: {
      tenantId: lastInput.tenantId,
      accountId: lastInput.accountId,
      correlationId: CORRELATION_ID,
      recommendationId: lastInput.recommendationId,
      jobId: lastInput.jobId,
    },
  });

  const evidence = buildHighConfidenceMatureEvidenceInput();
  await readiness.assess({
    ...buildAssessInputFromPipeline({
      pipeline: {
        lastInput,
        lastObservationId: lastRecorded.observation.observationId,
        lastLogicalObservationId: lastRecorded.observation.logicalObservationId,
        lastPersistenceState: lastRecorded.observation.assessment.state,
        lastMaturity: 'MATURE',
      },
      ...evidence,
      governanceConvergence: buildGovernancePreservedContext(),
    }),
    actionLogContext: {
      tenantId: lastInput.tenantId,
      accountId: lastInput.accountId,
      correlationId: CORRELATION_ID,
      recommendationId: lastInput.recommendationId,
      jobId: lastInput.jobId,
    },
  });

  const lifecycle = await actionLogService.reconstructCorrelationLifecycle(
    lastInput.tenantId,
    CORRELATION_ID,
  );

  const eventTypes = lifecycle.items.map((item) => item.eventType);
  assert.ok(eventTypes.includes('RECOMMENDATION_OBSERVED'));
  assert.ok(eventTypes.includes('PERSISTENCE_EVALUATED'));
  assert.ok(eventTypes.includes('MATURITY_EVALUATED'));
  assert.ok(eventTypes.includes('GOVERNANCE_EVALUATED'));
  assert.ok(eventTypes.includes('CONFIDENCE_EVALUATED'));
  assert.ok(eventTypes.includes('DECISION_READINESS_EVALUATED'));

  assert.ok(
    lifecycle.items.every(
      (item) =>
        item.correlationId === CORRELATION_ID &&
        item.tenantId === lastInput.tenantId &&
        item.accountId === lastInput.accountId,
    ),
  );
  assert.ok(lifecycle.items.every((item) => item.sourceRecordId.length > 0));

  const duplicate = await emitter.emit(
    buildGovernanceEvaluatedEventInput({
      result: {
        resultId: 'gov-result-fixture-1',
        tenantId: lastInput.tenantId,
        accountId: lastInput.accountId,
        region: lastInput.region,
        resourceType: 'INSTANCE',
        resourceId: lastInput.resourceId,
        check: 'unrestricted_ssh',
        findingKey: lastInput.findingKey,
        analysisRunId: lastInput.analysisRunId,
        evaluatedAt: lastInput.observationTimestamp,
        ruleVersion: '1.0.0',
        state: 'PRESERVED',
        reasonCodes: [],
        persistedAt: lastInput.observationTimestamp,
        version: 1,
      },
      context: {
        tenantId: lastInput.tenantId,
        accountId: lastInput.accountId,
        correlationId: CORRELATION_ID,
        recommendationId: lastInput.recommendationId,
      },
    }),
  );
  assert.equal(duplicate.created, false);
  assert.equal(
    (await actionLogService.reconstructCorrelationLifecycle(
      lastInput.tenantId,
      CORRELATION_ID,
    )).items.length,
    lifecycle.items.length,
  );
});

test('duplicate evidence observation emitter path remains idempotent', async () => {
  const observations = new MockEvidenceObservationRepository();
  const actionLogService = new ActionLogService(new MockActionLogRepository());
  const emitter = new ActionLogEmitter(actionLogService);
  const persistence = new EvidencePersistenceService(observations, emitter);
  const scenario = buildMatureStablePersistenceScenario();
  const input = {
    ...scenario.inputs[0]!,
    correlationId: CORRELATION_ID,
  };

  const first = await persistence.recordObservation(input);
  const second = await persistence.recordObservation(input);

  assert.equal(first.created, true);
  assert.equal(second.created, false);

  const lifecycle = await actionLogService.reconstructCorrelationLifecycle(
    input.tenantId,
    CORRELATION_ID,
  );
  assert.equal(lifecycle.items.length, 2);
});
