import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { EVIDENCE_MATURITY_MODEL_VERSION } from '../../evidence-maturity/model-version';
import { evaluateEvidenceMaturity } from '../../evidence-maturity';
import { DynamoDbEvidenceMaturityRepository } from '../../repositories/dynamodb/dynamodb-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';
import {
  buildDynamoSafeFindingKey,
  buildEvidenceIdentity,
  buildPersistentRecommendationScenario,
  buildRecordEvidenceObservationInput,
} from '../fixtures/evidence';

const EVALUATED_AT = '2026-08-12T12:10:00.000Z';

function createRepository(): DynamoDbEvidenceMaturityRepository {
  const { client } = createLinkedFakePersistenceTables();
  return new DynamoDbEvidenceMaturityRepository(
    client as unknown as DynamoDBDocumentClient,
    'sisum-cloud-resources-test',
  );
}

describe('DynamoDbEvidenceMaturityRepository parity', () => {
  it('creates maturity assessment with modelVersion and provenance', async () => {
    const observations = new MockEvidenceObservationRepository();
    const identity = buildEvidenceIdentity();
    const findingKey = buildDynamoSafeFindingKey(identity);
    const scenario = buildPersistentRecommendationScenario();
    for (const input of scenario.inputs) {
      await observations.recordObservation({ ...input, findingKey });
    }
    const page = await observations.listObservationsForFinding({
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      findingKey,
      limit: 100,
    });
    const source = page.items[page.items.length - 1]!;
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: source,
      findingHistory: page.items,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });

    const repo = createRepository();
    const created = await repo.recordAssessment(assessment);
    assert.equal(created.created, true);
    assert.equal(created.record.modelVersion, EVIDENCE_MATURITY_MODEL_VERSION);
    assert.ok(created.record.stableEpochLogicalObservationIds.length > 0);
  });

  it('deduplicates logical maturity assessments', async () => {
    const repo = createRepository();
    const observations = new MockEvidenceObservationRepository();
    const input = buildRecordEvidenceObservationInput({
      findingKey: buildDynamoSafeFindingKey(buildEvidenceIdentity()),
    });
    const recorded = await observations.recordObservation(input);
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: recorded.observation,
      findingHistory: [recorded.observation],
      telemetryApplicability: 'NOT_APPLICABLE',
      dataCompleteness: 'NOT_APPLICABLE',
      evaluatedAt: EVALUATED_AT,
    });
    const first = await repo.recordAssessment(assessment);
    const second = await repo.recordAssessment(assessment);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
  });
});
