import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

import { EVIDENCE_MATURITY_MODEL_VERSION } from '../../evidence-maturity/model-version';
import type { EvidenceMaturityAssessment } from '../../evidence-maturity/types';
import { DynamoDbEvidenceMaturityRepository } from '../../repositories/dynamodb/dynamodb-evidence-maturity-repository';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';
import {
  ACCOUNT_A,
  TENANT_A,
  buildDynamoSafeFindingKey,
  buildEvidenceIdentity,
} from '../fixtures/evidence';

const FINDING_KEY = buildDynamoSafeFindingKey(buildEvidenceIdentity());
const SOURCE_OBSERVATION_TIMESTAMP = '2026-08-01T10:00:00.000Z';
const LOGICAL_ID = 'logical-concurrency-shared';

function buildAssessment(input: {
  sourceLogicalObservationId?: string;
  sourceObservationTimestamp?: string;
  evaluatedAt?: string;
  modelVersion?: string;
  persistedAt?: string;
}): EvidenceMaturityAssessment {
  const sourceLogicalObservationId = input.sourceLogicalObservationId ?? LOGICAL_ID;
  return {
    maturity: 'IMMATURE',
    score: 0,
    reasonCodes: [],
    observationCount: 1,
    stableEpochObservationCount: 1,
    persistenceHours: null,
    stableEpochHours: 0,
    evidenceCompleteness: 'NOT_APPLICABLE',
    telemetryApplicability: 'NOT_APPLICABLE',
    evaluatedAt: input.evaluatedAt ?? '2026-08-01T12:00:00.001Z',
    sourceObservationTimestamp: input.sourceObservationTimestamp ?? SOURCE_OBSERVATION_TIMESTAMP,
    modelVersion: input.modelVersion ?? EVIDENCE_MATURITY_MODEL_VERSION,
    sourceObservationId: `obs-${sourceLogicalObservationId}`,
    sourceLogicalObservationId,
    sourcePersistenceState: 'NEW',
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    region: 'us-east-1',
    resourceId: 'i-abc',
    findingKey: FINDING_KEY,
    recommendationFingerprint: 'fp',
    ruleId: 'ec2.cost.stopped_with_storage',
    ruleVersion: '1.0.0',
    category: 'STOPPED_WITH_STORAGE',
    analysisRunId: 'run-1',
    stableEpochObservationIds: [`obs-${sourceLogicalObservationId}`],
    stableEpochLogicalObservationIds: [sourceLogicalObservationId],
    scoreFactors: [],
  };
}

function createDynamoRepository(): {
  repo: DynamoDbEvidenceMaturityRepository;
  client: DynamoDBDocumentClient;
} {
  const { client } = createLinkedFakePersistenceTables();
  return {
    repo: new DynamoDbEvidenceMaturityRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    ),
    client: client as unknown as DynamoDBDocumentClient,
  };
}

async function assertSingleLogicalRecord(
  repo: MockEvidenceMaturityRepository | DynamoDbEvidenceMaturityRepository,
  sourceLogicalObservationId: string = LOGICAL_ID,
): Promise<void> {
  const page = await repo.listAssessmentsForFinding({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    findingKey: FINDING_KEY,
    limit: 100,
  });
  const matching = page.items.filter(
    (item) =>
      item.sourceLogicalObservationId === sourceLogicalObservationId &&
      item.modelVersion === EVIDENCE_MATURITY_MODEL_VERSION,
  );
  assert.equal(matching.length, 1);
}

describe('EvidenceMaturityRepository idempotency and concurrency', () => {
  it('DynamoDB concurrent duplicate evaluations with different evaluatedAt create one logical record', async () => {
    const { repo } = createDynamoRepository();
    const shared = buildAssessment({
      evaluatedAt: '2026-08-01T12:00:00.001Z',
    });
    const raced = buildAssessment({
      evaluatedAt: '2026-08-01T12:00:00.999Z',
    });

    const [first, second] = await Promise.all([
      repo.recordAssessment(shared),
      repo.recordAssessment(raced),
    ]);

    const createdCount = [first, second].filter((result) => result.created).length;
    assert.equal(createdCount, 1);
    assert.notEqual(first.record.assessmentId, undefined);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
    assert.equal(first.record.sourceObservationTimestamp, SOURCE_OBSERVATION_TIMESTAMP);
    assert.equal(second.record.sourceObservationTimestamp, SOURCE_OBSERVATION_TIMESTAMP);
    await assertSingleLogicalRecord(repo);
  });

  it('mock concurrent duplicate evaluations with different evaluatedAt create one logical record', async () => {
    const repo = new MockEvidenceMaturityRepository();
    const [first, second] = await Promise.all([
      repo.recordAssessment(
        buildAssessment({ evaluatedAt: '2026-08-01T12:00:00.001Z' }),
      ),
      repo.recordAssessment(
        buildAssessment({ evaluatedAt: '2026-08-01T12:00:00.999Z' }),
      ),
    ]);

    const createdCount = [first, second].filter((result) => result.created).length;
    assert.equal(createdCount, 1);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
    await assertSingleLogicalRecord(repo);
  });

  it('same logical identity with different evaluatedAt returns one record', async () => {
    const { repo } = createDynamoRepository();
    const first = await repo.recordAssessment(
      buildAssessment({ evaluatedAt: '2026-08-01T12:00:00.001Z' }),
    );
    const second = await repo.recordAssessment(
      buildAssessment({ evaluatedAt: '2026-08-01T12:00:00.999Z' }),
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
    await assertSingleLogicalRecord(repo);
  });

  it('different modelVersion may coexist for the same logical observation', async () => {
    const { repo } = createDynamoRepository();
    const v1 = await repo.recordAssessment(
      buildAssessment({ modelVersion: EVIDENCE_MATURITY_MODEL_VERSION }),
    );
    const vNext = await repo.recordAssessment(
      buildAssessment({ modelVersion: `${EVIDENCE_MATURITY_MODEL_VERSION}-next` }),
    );
    assert.equal(v1.created, true);
    assert.equal(vNext.created, true);
    assert.notEqual(v1.record.assessmentId, vNext.record.assessmentId);

    const page = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 100,
    });
    assert.equal(page.items.length, 2);
  });

  it('different sourceLogicalObservationId may coexist', async () => {
    const { repo } = createDynamoRepository();
    const first = await repo.recordAssessment(
      buildAssessment({ sourceLogicalObservationId: 'logical-a' }),
    );
    const second = await repo.recordAssessment(
      buildAssessment({
        sourceLogicalObservationId: 'logical-b',
        sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
      }),
    );
    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.notEqual(first.record.assessmentId, second.record.assessmentId);

    const page = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 100,
    });
    assert.equal(page.items.length, 2);
  });

  it('persists sourceObservationTimestamp from assessment payload', async () => {
    const { repo } = createDynamoRepository();
    const created = await repo.recordAssessment(buildAssessment({}));
    assert.equal(
      created.record.sourceObservationTimestamp,
      SOURCE_OBSERVATION_TIMESTAMP,
    );
    assert.notEqual(created.record.evaluatedAt, created.record.sourceObservationTimestamp);
  });

  it('DynamoDB repository does not use ScanCommand', async () => {
    const { repo, client } = createDynamoRepository();
    const originalSend = client.send.bind(client);
    let scanInvoked = false;
    client.send = async (command: Parameters<typeof originalSend>[0]) => {
      if (command instanceof ScanCommand) {
        scanInvoked = true;
      }
      return originalSend(command);
    };

    await repo.recordAssessment(buildAssessment({}));
    await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 10,
    });

    assert.equal(scanInvoked, false);
  });
});
