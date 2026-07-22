import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MockLearningRepository,
  type ConfidenceHistoryEntry,
  type LearningFeedback,
} from '../../engines/learning';
import type { LearningRecord } from '../../shared/types';
import { PLUGIN_NAMES } from '../../shared/constants';

function buildRecord(overrides: Partial<LearningRecord> = {}): LearningRecord {
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
      explanation: { governance: 'approved', financial: 'savings', confidence: 'high' },
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
      financialImpact: { monthlySavings: 12, currency: 'USD' } as LearningRecord['outcome']['financialImpact'],
      completedAt: '2026-07-21T12:00:00.000Z',
    },
    recordedAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  } as LearningRecord;
}

describe('MockLearningRepository', () => {
  it('persists recommendations, metadata, feedback, and confidence history', async () => {
    const repository = new MockLearningRepository();
    const record = buildRecord();
    await repository.save(record);
    record.recommendation.summary = 'Changed outside the repository';

    const feedback: LearningFeedback = {
      feedbackId: 'feedback-001', tenantId: 'tenant-a', workflowId: 'workflow-001',
      recommendationStatus: 'RECOMMENDED', verdict: 'accepted', recordedAt: '2026-07-21T12:01:00.000Z',
    };
    const confidence: ConfidenceHistoryEntry = {
      historyId: 'confidence-001', tenantId: 'tenant-a', workflowId: 'workflow-001',
      confidence: { score: 92, status: 'HIGH', reason: 'Strong evidence', factors: [], level: 'high' },
      recordedAt: '2026-07-21T12:02:00.000Z',
    };
    await repository.addFeedback(feedback);
    await repository.appendConfidence(confidence);

    assert.equal((await repository.listMetadata('tenant-a'))[0]?.recommendationStatus, 'RECOMMENDED');
    assert.equal((await repository.listRecommendations('tenant-a'))[0]?.summary, 'Resize instance');
    assert.equal((await repository.listFeedback('tenant-a', 'workflow-001')).length, 1);
    assert.equal((await repository.listConfidenceHistory('tenant-a', 'workflow-001'))[0]?.confidence.score, 92);
  });

  it('keeps all learning data tenant-scoped', async () => {
    const repository = new MockLearningRepository();
    await repository.save(buildRecord());

    assert.equal(await repository.findByWorkflowId('tenant-b', 'workflow-001'), undefined);
    assert.deepEqual(await repository.list('tenant-b'), []);
    assert.deepEqual(await repository.listMetadata('tenant-b'), []);
    assert.deepEqual(await repository.listRecommendations('tenant-b'), []);
    assert.deepEqual(await repository.listFeedback('tenant-b'), []);
    assert.deepEqual(await repository.listConfidenceHistory('tenant-b'), []);
  });
});
