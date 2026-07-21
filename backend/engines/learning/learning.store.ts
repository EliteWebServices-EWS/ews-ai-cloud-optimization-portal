import type { LearningRecord, OptimizationOutcome } from '../../shared/types';
import { MockLearningRepository } from './mock-learning.repository';
import type { LearningRepository } from './learning.repository';

/** @deprecated Use LearningRepository; retained as a transition alias. */
export type LearningStoreInterface = LearningRepository;

/** Build a learning record without coupling the domain workflow to storage. */
export function buildLearningRecord(tenantId: string, outcome: OptimizationOutcome): LearningRecord {
  return {
    id: `lr-${outcome.workflowId}`,
    tenantId,
    workflowId: outcome.workflowId,
    plugin: outcome.plugin,
    recommendation: outcome.recommendation,
    execution: outcome.execution,
    observation: outcome.observation,
    verification: outcome.verification,
    ...(outcome.confidence ? { confidence: outcome.confidence } : {}),
    outcome,
    recordedAt: new Date().toISOString(),
  };
}

/** Creates the mock repository until a durable adapter is configured. */
export function createLearningStore(): MockLearningRepository {
  return new MockLearningRepository();
}
