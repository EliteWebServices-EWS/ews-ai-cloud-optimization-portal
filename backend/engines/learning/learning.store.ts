import type {
  LearningRecord,
  OptimizationOutcome,
  VerificationReport,
} from '../../shared/types';
import { recordBelongsToTenant } from '../../auth/tenant';
import { createLogger } from '../../shared/utils';

const logger = createLogger('LearningStore');

function buildStoreKey(tenantId: string, workflowId: string): string {
  return `${tenantId}:${workflowId}`;
}

export interface LearningStoreInterface {
  save(record: LearningRecord): LearningRecord;
  getByWorkflowId(tenantId: string, workflowId: string): LearningRecord | undefined;
  listReports(tenantId: string): VerificationReport[];
  listRecords(tenantId: string): LearningRecord[];
  buildRecord(tenantId: string, outcome: OptimizationOutcome): LearningRecord;
  resolveOwnerTenantId(workflowId: string): string | undefined;
}

/**
 * In-memory learning data store for closed-loop optimization outcomes.
 * Future ML models will consume persisted LearningRecord entries.
 * Sprint 6: no database persistence — deterministic in-memory storage only.
 * Sprint 10.5.16: tenant-scoped lookups prevent cross-tenant access.
 */
export class InMemoryLearningStore implements LearningStoreInterface {
  private readonly records = new Map<string, LearningRecord>();
  private readonly ownerIndex = new Map<string, string>();

  save(record: LearningRecord): LearningRecord {
    const key = buildStoreKey(record.tenantId, record.workflowId);
    this.records.set(key, record);
    this.ownerIndex.set(record.workflowId, record.tenantId);
    logger.info('Outcome stored', {
      workflowId: record.workflowId,
      operation: 'save',
      verificationStatus: record.verification.status,
    });
    return record;
  }

  getByWorkflowId(tenantId: string, workflowId: string): LearningRecord | undefined {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));

    if (!record) {
      return undefined;
    }

    if (!recordBelongsToTenant(record.tenantId, tenantId)) {
      return undefined;
    }

    return record;
  }

  listReports(tenantId: string): VerificationReport[] {
    return this.listRecords(tenantId).map((record) => ({
      tenantId: record.tenantId,
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

  listRecords(tenantId: string): LearningRecord[] {
    return [...this.records.values()].filter((record) =>
      recordBelongsToTenant(record.tenantId, tenantId)
    );
  }

  buildRecord(tenantId: string, outcome: OptimizationOutcome): LearningRecord {
    return {
      id: `lr-${outcome.workflowId}`,
      tenantId,
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

  resolveOwnerTenantId(workflowId: string): string | undefined {
    return this.ownerIndex.get(workflowId);
  }
}

export function createLearningStore(): InMemoryLearningStore {
  return new InMemoryLearningStore();
}
