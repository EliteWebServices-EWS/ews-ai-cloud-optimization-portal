import type { LearningRecord, OptimizationOutcome } from '../../shared/types';
import { getPersistenceTable } from '../../persistence/persistence-table';
import { MockLearningRepository } from './mock-learning.repository';
import { DynamoDbLearningRepository } from './dynamodb-learning.repository';
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

/**
 * Creates the DynamoDB-backed repository when persistence is configured,
 * falling back to the in-memory mock for local development and tests.
 */
export function createLearningStore(): LearningRepository {
  const table = getPersistenceTable();
  return table
    ? new DynamoDbLearningRepository(table)
    : new MockLearningRepository();
}
