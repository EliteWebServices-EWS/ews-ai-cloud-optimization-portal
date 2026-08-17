import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { cloudResourceAccountPartitionKey, InvalidPaginationTokenError } from '../../database';
import { evidenceMaturityAssessmentSortKey } from '../../database/cloud-resources/evidence-maturity-keys';
import { EVIDENCE_MATURITY_MODEL_VERSION } from '../../evidence-maturity/model-version';
import type { EvidenceMaturityAssessment } from '../../evidence-maturity/types';
import { normalizeObservationTimestampIso } from '../../persistence-intelligence/timestamp-rules';
import { DynamoDbEvidenceMaturityRepository } from '../../repositories/dynamodb/dynamodb-evidence-maturity-repository';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { decodeEvidenceMaturityNextToken } from '../../repositories/evidence-maturity-pagination';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
  buildDynamoSafeFindingKey,
  buildEvidenceIdentity,
} from '../fixtures/evidence';

const FINDING_KEY = buildDynamoSafeFindingKey(buildEvidenceIdentity());

function buildMinimalAssessment(input: {
  sourceObservationTimestamp: string;
  sourceLogicalObservationId: string;
  evaluatedAt?: string;
  modelVersion?: string;
  findingKey?: string;
  tenantId?: string;
  accountId?: string;
}): EvidenceMaturityAssessment {
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
    evaluatedAt: input.evaluatedAt ?? input.sourceObservationTimestamp,
    sourceObservationTimestamp: input.sourceObservationTimestamp,
    modelVersion: input.modelVersion ?? EVIDENCE_MATURITY_MODEL_VERSION,
    sourceObservationId: `obs-${input.sourceLogicalObservationId}`,
    sourceLogicalObservationId: input.sourceLogicalObservationId,
    sourcePersistenceState: 'NEW',
    tenantId: input.tenantId ?? TENANT_A,
    accountId: input.accountId ?? ACCOUNT_A,
    region: 'us-east-1',
    resourceId: 'i-abc',
    findingKey: input.findingKey ?? FINDING_KEY,
    recommendationFingerprint: 'fp',
    ruleId: 'ec2.cost.stopped_with_storage',
    ruleVersion: '1.0.0',
    category: 'STOPPED_WITH_STORAGE',
    analysisRunId: 'run-1',
    stableEpochObservationIds: [`obs-${input.sourceLogicalObservationId}`],
    stableEpochLogicalObservationIds: [input.sourceLogicalObservationId],
    scoreFactors: [],
  };
}

async function seedChronologicalAssessments(
  repo: MockEvidenceMaturityRepository | DynamoDbEvidenceMaturityRepository,
  specs: Array<{ sourceObservationTimestamp: string; sourceLogicalObservationId: string }>,
): Promise<void> {
  for (const spec of specs) {
    await repo.recordAssessment(buildMinimalAssessment(spec));
  }
}

function createDynamoRepository(): DynamoDbEvidenceMaturityRepository {
  const { client } = createLinkedFakePersistenceTables();
  return new DynamoDbEvidenceMaturityRepository(
    client as unknown as DynamoDBDocumentClient,
    'sisum-cloud-resources-test',
  );
}

async function assertChronologicalPages(
  repo: MockEvidenceMaturityRepository | DynamoDbEvidenceMaturityRepository,
  expectedTimestamps: string[],
): Promise<void> {
  const collected: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
      nextToken,
    });
    collected.push(
      ...page.items.map((item) =>
        normalizeObservationTimestampIso(item.sourceObservationTimestamp),
      ),
    );
    nextToken = page.nextToken;
  } while (nextToken);

  assert.deepEqual(
    collected,
    expectedTimestamps.map((value) => normalizeObservationTimestampIso(value)),
  );
}

describe('EvidenceMaturityRepository pagination parity', () => {
  const orderingSpecs = [
    {
      sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
      sourceLogicalObservationId: 'logical-id-z-last-lex',
    },
    {
      sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
      sourceLogicalObservationId: 'logical-id-a-first-lex',
    },
    {
      sourceObservationTimestamp: '2026-08-03T10:00:00.000Z',
      sourceLogicalObservationId: 'logical-id-m-middle-lex',
    },
  ];

  it('mock lists by sourceObservationTimestamp ascending when logical IDs are out of lexical order', async () => {
    const repo = new MockEvidenceMaturityRepository();
    await seedChronologicalAssessments(repo, orderingSpecs);
    await assertChronologicalPages(
      repo,
      orderingSpecs.map((spec) => spec.sourceObservationTimestamp),
    );
  });

  it('DynamoDB lists by sourceObservationTimestamp ascending when logical IDs are out of lexical order', async () => {
    const repo = createDynamoRepository();
    await seedChronologicalAssessments(repo, orderingSpecs);
    await assertChronologicalPages(
      repo,
      orderingSpecs.map((spec) => spec.sourceObservationTimestamp),
    );
  });

  it('mock paginates five assessments as T1,T2 then T3,T4 then T5', async () => {
    const repo = new MockEvidenceMaturityRepository();
    const five = Array.from({ length: 5 }, (_, index) => ({
      sourceObservationTimestamp: new Date(
        Date.parse('2026-08-01T00:00:00.000Z') + index * 3600000,
      ).toISOString(),
      sourceLogicalObservationId: `logical-page-${index}`,
    }));
    await seedChronologicalAssessments(repo, five);

    const page1 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
    });
    const page2 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
      nextToken: page1.nextToken,
    });
    const page3 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
      nextToken: page2.nextToken,
    });

    assert.equal(page1.items.length, 2);
    assert.equal(page2.items.length, 2);
    assert.equal(page3.items.length, 1);
    assert.equal(page3.nextToken, undefined);
    assert.deepEqual(
      [...page1.items, ...page2.items, ...page3.items].map((item) => item.sourceLogicalObservationId),
      five.map((spec) => spec.sourceLogicalObservationId),
    );
  });

  it('DynamoDB paginates five assessments as T1,T2 then T3,T4 then T5', async () => {
    const repo = createDynamoRepository();
    const five = Array.from({ length: 5 }, (_, index) => ({
      sourceObservationTimestamp: new Date(
        Date.parse('2026-08-01T00:00:00.000Z') + index * 3600000,
      ).toISOString(),
      sourceLogicalObservationId: `logical-dynamo-page-${index}`,
    }));
    await seedChronologicalAssessments(repo, five);

    const page1 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
    });
    const page2 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
      nextToken: page1.nextToken,
    });
    const page3 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 2,
      nextToken: page2.nextToken,
    });

    assert.equal(page1.items.length, 2);
    assert.equal(page2.items.length, 2);
    assert.equal(page3.items.length, 1);
    assert.equal(page3.nextToken, undefined);
  });

  it('mock continuation token uses cloudResourceAccountPartitionKey and canonical sort key', async () => {
    const repo = new MockEvidenceMaturityRepository();
    await seedChronologicalAssessments(repo, [
      {
        sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-token-a',
      },
      {
        sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-token-b',
      },
      {
        sourceObservationTimestamp: '2026-08-03T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-token-c',
      },
    ]);

    const page1 = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 1,
    });
    assert.ok(page1.nextToken);
    const decoded = decodeEvidenceMaturityNextToken(page1.nextToken, {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
    });
    assert.equal(decoded?.pk, cloudResourceAccountPartitionKey(TENANT_A, ACCOUNT_A));
    assert.notEqual(decoded?.pk, 'mock');
    assert.equal(
      decoded?.sk,
      evidenceMaturityAssessmentSortKey({
        findingKey: FINDING_KEY,
        sourceObservationTimestampIso: normalizeObservationTimestampIso(
          page1.items[0]!.sourceObservationTimestamp,
        ),
        sourceLogicalObservationId: page1.items[0]!.sourceLogicalObservationId,
        modelVersion: EVIDENCE_MATURITY_MODEL_VERSION,
      }),
    );
  });

  it('rejects Tenant A token against Tenant B list query', async () => {
    const repo = new MockEvidenceMaturityRepository();
    await seedChronologicalAssessments(repo, [
      {
        sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-tenant-a-1',
      },
      {
        sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-tenant-a-2',
      },
    ]);
    const page = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 1,
    });
    assert.ok(page.nextToken);

    assert.throws(
      () =>
        decodeEvidenceMaturityNextToken(page.nextToken, {
          tenantId: TENANT_B,
          accountId: ACCOUNT_A,
          findingKey: FINDING_KEY,
        }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects token against different account scope', async () => {
    const repo = new MockEvidenceMaturityRepository();
    await seedChronologicalAssessments(repo, [
      {
        sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-account-a-1',
      },
      {
        sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-account-a-2',
      },
    ]);
    const page = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 1,
    });
    assert.ok(page.nextToken);

    assert.throws(
      () =>
        decodeEvidenceMaturityNextToken(page.nextToken, {
          tenantId: TENANT_A,
          accountId: ACCOUNT_B,
          findingKey: FINDING_KEY,
        }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects token against different finding scope', async () => {
    const repo = new MockEvidenceMaturityRepository();
    await seedChronologicalAssessments(repo, [
      {
        sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-finding-a-1',
      },
      {
        sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-finding-a-2',
      },
    ]);
    const page = await repo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: FINDING_KEY,
      limit: 1,
    });
    assert.ok(page.nextToken);
    const otherFinding = buildDynamoSafeFindingKey({
      ...buildEvidenceIdentity(),
      resourceId: 'i-other-finding',
    });
    assert.throws(
      () =>
        decodeEvidenceMaturityNextToken(page.nextToken, {
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          findingKey: otherFinding,
        }),
      InvalidPaginationTokenError,
    );
  });

  it('lists late out-of-order observations by sourceObservationTimestamp', async () => {
    const repo = createDynamoRepository();
    const writeOrder = [
      {
        sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-ooo-t1',
      },
      {
        sourceObservationTimestamp: '2026-08-03T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-ooo-t3',
      },
      {
        sourceObservationTimestamp: '2026-08-02T10:00:00.000Z',
        sourceLogicalObservationId: 'logical-ooo-t2',
      },
    ];
    for (const spec of writeOrder) {
      await repo.recordAssessment(buildMinimalAssessment(spec));
    }
    await assertChronologicalPages(repo, [
      '2026-08-01T10:00:00.000Z',
      '2026-08-02T10:00:00.000Z',
      '2026-08-03T10:00:00.000Z',
    ]);
  });

  it('duplicate logical evaluation remains idempotent after key change', async () => {
    const repo = new MockEvidenceMaturityRepository();
    const assessment = buildMinimalAssessment({
      sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
      sourceLogicalObservationId: 'logical-dup-idempotent',
    });
    const first = await repo.recordAssessment(assessment);
    const second = await repo.recordAssessment(assessment);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
  });

  it('DynamoDB duplicate logical evaluation remains idempotent after key change', async () => {
    const repo = createDynamoRepository();
    const assessment = buildMinimalAssessment({
      sourceObservationTimestamp: '2026-08-01T10:00:00.000Z',
      sourceLogicalObservationId: 'logical-dynamo-dup-idempotent',
    });
    const first = await repo.recordAssessment(assessment);
    const second = await repo.recordAssessment(assessment);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
  });
});
