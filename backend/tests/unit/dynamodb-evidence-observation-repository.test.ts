import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { PersistenceDataQualityError } from '../../persistence-intelligence/errors';
import { DynamoDbEvidenceObservationRepository } from '../../repositories/dynamodb/dynamodb-evidence-observation-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';
import {
  ACCOUNT_A,
  buildChangedRecommendationScenario,
  buildDuplicateObservationScenario,
  buildDynamoSafeFindingKey,
  buildEvidenceIdentity,
  buildMissingPreviousScenario,
  buildNewRecommendationScenario,
  buildOutOfOrderObservationScenario,
  buildPersistentRecommendationScenario,
  buildRecordEvidenceObservationInput,
  replayPersistenceScenario,
  TENANT_A,
  TENANT_B,
  type NamedPersistenceScenario,
} from '../fixtures/evidence';

function dynamoInput(
  overrides: Parameters<typeof buildRecordEvidenceObservationInput>[0] = {},
) {
  const identity = buildEvidenceIdentity(overrides.identity);
  return buildRecordEvidenceObservationInput({
    ...overrides,
    findingKey: overrides.findingKey ?? buildDynamoSafeFindingKey(identity),
  });
}

function toDynamoScenario(scenario: NamedPersistenceScenario): NamedPersistenceScenario {
  const findingKey = buildDynamoSafeFindingKey(buildEvidenceIdentity());
  return {
    ...scenario,
    inputs: scenario.inputs.map((input) => ({
      ...input,
      findingKey,
    })),
  };
}

function createRepository(): DynamoDbEvidenceObservationRepository {
  const { client } = createLinkedFakePersistenceTables();
  return new DynamoDbEvidenceObservationRepository(
    client as unknown as DynamoDBDocumentClient,
    'sisum-cloud-resources-test',
  );
}

describe('DynamoDbEvidenceObservationRepository parity', () => {
  it('inserts a NEW observation', async () => {
    const repo = createRepository();
    const result = await repo.recordObservation(dynamoInput());
    assert.equal(result.created, true);
    assert.equal(result.assessment.state, 'NEW');
  });

  it('deduplicates exact logical observations', async () => {
    const repo = createRepository();
    const input = dynamoInput({ analysisRunId: 'run-dynamo-dup' });
    const first = await repo.recordObservation(input);
    const second = await repo.recordObservation(input);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.observation.observationId, second.observation.observationId);
  });

  it('replays persistent recommendation scenario NEW → STABLE → STABLE', async () => {
    const repo = createRepository();
    const results = await replayPersistenceScenario(
      repo,
      toDynamoScenario(buildPersistentRecommendationScenario()),
    );
    assert.deepEqual(results.map((entry) => entry.state), ['NEW', 'STABLE', 'STABLE']);
  });

  it('replays changed recommendation scenario NEW → CHANGED', async () => {
    const repo = createRepository();
    const results = await replayPersistenceScenario(
      repo,
      toDynamoScenario(buildChangedRecommendationScenario()),
    );
    assert.deepEqual(results.map((entry) => entry.state), ['NEW', 'CHANGED']);
  });

  it('returns MISSING_PREVIOUS when expected prior history is absent', async () => {
    const repo = createRepository();
    const results = await replayPersistenceScenario(
      repo,
      toDynamoScenario(buildMissingPreviousScenario()),
    );
    assert.deepEqual(results, [{ created: true, state: 'MISSING_PREVIOUS' }]);
  });

  it('finds relevant previous observation for later STABLE classification', async () => {
    const repo = createRepository();
    const scenario = toDynamoScenario(buildNewRecommendationScenario());
    await repo.recordObservation(scenario.inputs[0]!);
    const second = dynamoInput({
      analysisRunId: 'run-dynamo-stable',
      observationTimestamp: '2026-08-11T12:00:00.000Z',
      collectionTimestamp: '2026-08-11T12:05:00.000Z',
      recommendationVersion: 2,
    });
    const result = await repo.recordObservation(second);
    assert.equal(result.assessment.state, 'STABLE');
    const prior = await repo.findRelevantPreviousObservation({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: second.findingKey,
      beforeObservationTimestamp: second.observationTimestamp,
    });
    assert.ok(prior);
  });

  it('handles out-of-order observations without corrupting history', async () => {
    const repo = createRepository();
    const scenario = toDynamoScenario(buildOutOfOrderObservationScenario());
    const results = await replayPersistenceScenario(repo, scenario);
    assert.deepEqual(results.map((entry) => entry.state), ['NEW', 'STABLE', 'STABLE']);
    const listed = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: scenario.inputs[0]!.findingKey,
    });
    assert.equal(listed.items.length, 3);
  });

  it('denies cross-tenant reads via tenant-scoped queries', async () => {
    const repo = createRepository();
    const input = dynamoInput();
    await repo.recordObservation(input);
    const listed = await repo.listObservationsForFinding({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: input.findingKey,
    });
    assert.equal(listed.items.length, 0);
  });

  it('returns null for cross-tenant logical id lookup', async () => {
    const repo = createRepository();
    const created = await repo.recordObservation(dynamoInput());
    const lookedUp = await repo.getObservationByLogicalId({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: created.observation.findingKey,
      analysisRunId: created.observation.analysisRunId,
      observationTimestamp: created.observation.observationTimestamp,
    });
    assert.equal(lookedUp, null);
  });

  it('rejects malformed observation timestamps', async () => {
    const repo = createRepository();
    await assert.rejects(
      () =>
        repo.recordObservation(
          dynamoInput({
            observationTimestamp: 'not-a-date',
          }),
        ),
      PersistenceDataQualityError,
    );
  });

  it('replays duplicate scenario with idempotent second write', async () => {
    const repo = createRepository();
    const results = await replayPersistenceScenario(
      repo,
      toDynamoScenario(buildDuplicateObservationScenario()),
    );
    assert.equal(results[0]?.created, true);
    assert.equal(results[1]?.created, false);
  });
});
