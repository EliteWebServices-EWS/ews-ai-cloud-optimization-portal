import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DynamoDbLearningRepository,
  type ConfidenceHistoryEntry,
  type LearningFeedback,
} from '../../engines/learning';
import type { LearningRecord } from '../../shared/types';
import { PLUGIN_NAMES } from '../../shared/constants';
import { createFakePersistenceTable } from './support/fake-persistence-table';

function buildRecord(
  overrides: Partial<LearningRecord> = {}
): LearningRecord {
  return {
    id: 'lr-workflow-001',
    tenantId: 'tenant-a',
    workflowId: 'workflow-001',
    plugin: PLUGIN_NAMES.EC2,
    recommendation: {
      status: 'RECOMMENDED',
      summary: 'Resize instance',
      reason: 'Savings available',
      detail: {
        action: 'resize',
        fromInstanceType: 'm5.large',
        toInstanceType: 'm5.medium',
        description: 'Resize',
      },
      explanation: {
        governance: 'approved',
        financial: 'savings',
        confidence: 'high',
      },
      reasons: [],
    },
    execution: { executionId: 'exec-001' },
    observation: { executionId: 'exec-001' },
    verification: { status: 'verified', message: 'Verified' },
    outcome: {
      workflowId: 'workflow-001',
      plugin: PLUGIN_NAMES.EC2,
      recommendation: {} as LearningRecord['recommendation'],
      execution: {} as LearningRecord['execution'],
      observation: {} as LearningRecord['observation'],
      verification: {} as LearningRecord['verification'],
      candidate: {} as LearningRecord['outcome']['candidate'],
      financialImpact: {
        monthlySavings: 12,
        currency: 'USD',
      } as LearningRecord['outcome']['financialImpact'],
      completedAt: '2026-07-21T12:00:00.000Z',
    },
    recordedAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  } as LearningRecord;
}

function buildFeedback(
  overrides: Partial<LearningFeedback> = {}
): LearningFeedback {
  return {
    feedbackId: 'feedback-001',
    tenantId: 'tenant-a',
    workflowId: 'workflow-001',
    recommendationStatus: 'RECOMMENDED',
    verdict: 'accepted',
    recordedAt: '2026-07-21T12:01:00.000Z',
    ...overrides,
  };
}

function buildConfidence(
  overrides: Partial<ConfidenceHistoryEntry> = {}
): ConfidenceHistoryEntry {
  return {
    historyId: 'confidence-001',
    tenantId: 'tenant-a',
    workflowId: 'workflow-001',
    confidence: {
      score: 92,
      status: 'HIGH',
      reason: 'Strong evidence',
      factors: [],
      level: 'high',
    } as ConfidenceHistoryEntry['confidence'],
    recordedAt: '2026-07-21T12:02:00.000Z',
    ...overrides,
  };
}

describe('DynamoDbLearningRepository', () => {
  it('persists records, feedback, and confidence history', async () => {
    const repository = new DynamoDbLearningRepository(
      createFakePersistenceTable()
    );

    await repository.save(buildRecord());
    await repository.addFeedback(buildFeedback());
    await repository.appendConfidence(buildConfidence());
    await repository.appendConfidence(
      buildConfidence({
        historyId: 'confidence-002',
        recordedAt: '2026-07-21T12:03:00.000Z',
      })
    );

    assert.equal(
      (await repository.listMetadata('tenant-a'))[0]?.recommendationStatus,
      'RECOMMENDED'
    );
    assert.equal(
      (await repository.listRecommendations('tenant-a'))[0]?.summary,
      'Resize instance'
    );
    assert.equal(
      (await repository.listFeedback('tenant-a', 'workflow-001')).length,
      1
    );
    const confidence = await repository.listConfidenceHistory(
      'tenant-a',
      'workflow-001'
    );
    assert.deepEqual(
      confidence.map((entry) => entry.historyId),
      ['confidence-001', 'confidence-002']
    );
  });

  it('rejects feedback for a missing learning record', async () => {
    const repository = new DynamoDbLearningRepository(
      createFakePersistenceTable()
    );

    await assert.rejects(
      () => repository.addFeedback(buildFeedback({ workflowId: 'ghost' })),
      /Learning record not found/
    );
  });

  it('resolves the owner tenant for denial auditing but isolates reads', async () => {
    const repository = new DynamoDbLearningRepository(
      createFakePersistenceTable()
    );
    await repository.save(buildRecord());

    assert.equal(
      await repository.resolveOwnerTenantId('workflow-001'),
      'tenant-a'
    );
    assert.equal(
      await repository.findByWorkflowId('tenant-b', 'workflow-001'),
      undefined
    );
    assert.deepEqual(await repository.list('tenant-b'), []);
  });

  it('survives a fresh repository over the same table (restart)', async () => {
    const table = createFakePersistenceTable();
    await new DynamoDbLearningRepository(table).save(buildRecord());

    const afterRestart = new DynamoDbLearningRepository(table);
    assert.equal(
      (await afterRestart.findByWorkflowId('tenant-a', 'workflow-001'))
        ?.recommendation.summary,
      'Resize instance'
    );
  });
});
