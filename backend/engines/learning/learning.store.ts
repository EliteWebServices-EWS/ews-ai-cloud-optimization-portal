import type {
  LearningRecord,
  OptimizationOutcome,
  VerificationReport,
} from '../../shared/types';
import { createLogger } from '../../shared/utils';

const logger = createLogger('LearningStore');

export interface LearningStoreInterface {
  save(record: LearningRecord): LearningRecord;
  getByWorkflowId(workflowId: string): LearningRecord | undefined;
  listReports(): VerificationReport[];
  listRecords(): LearningRecord[];
  buildRecord(outcome: OptimizationOutcome): LearningRecord;
}

/**
 * In-memory learning data store for closed-loop optimization outcomes.
 * Future ML models will consume persisted LearningRecord entries.
 * Sprint 6: no database persistence — deterministic in-memory storage only.
 */
export class InMemoryLearningStore implements LearningStoreInterface {
  private readonly records = new Map<string, LearningRecord>();

  save(record: LearningRecord): LearningRecord {
    this.records.set(record.workflowId, record);
    logger.info('Outcome stored', {
      workflowId: record.workflowId,
      operation: 'save',
      verificationStatus: record.verification.status,
    });
    return record;
  }

  getByWorkflowId(workflowId: string): LearningRecord | undefined {
    return this.records.get(workflowId);
  }

  listReports(): VerificationReport[] {
    return [...this.records.values()].map((record) => ({
      workflowId: record.workflowId,
      executionId: record.execution.executionId,
      status: record.verification.status,
      expected: {
        expectedMonthlySavings: record.outcome.financialImpact.monthlySavings,
        expectedInstanceType: record.recommendation.detail.toInstanceType,
        previousInstanceType: record.recommendation.detail.fromInstanceType,
        currency: record.outcome.financialImpact.currency,
      },
      observation: record.observation,
      result: record.verification,
      generatedAt: record.recordedAt,
      summary: `${record.verification.status.toUpperCase()}: ${record.verification.message ?? 'Verification complete'}`,
    }));
  }

  listRecords(): LearningRecord[] {
    return [...this.records.values()];
  }

  buildRecord(outcome: OptimizationOutcome): LearningRecord {
    return {
      id: `lr-${outcome.workflowId}`,
      workflowId: outcome.workflowId,
      plugin: outcome.plugin,
      recommendation: outcome.recommendation,
      execution: outcome.execution,
      observation: outcome.observation,
      verification: outcome.verification,
      outcome,
      recordedAt: new Date().toISOString(),
    };
  }
}

export function createLearningStore(): InMemoryLearningStore {
  return new InMemoryLearningStore();
}
