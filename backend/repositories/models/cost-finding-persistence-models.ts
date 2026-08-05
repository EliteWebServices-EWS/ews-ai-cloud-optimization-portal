import type {
  TenantRecordIdentity,
  VersionedRecord,
} from '../contracts/repository-types';

import type {
  CostFindingSeverity,
  CostFindingStatus,
  CostFindingType,
} from '../../shared/constants';

/**
 * Durable, tenant-partitioned record of one EC2 Cost Intelligence finding.
 *
 * financialImpact and confidence are stored as opaque JSON — they are the
 * exact FinancialImpact / ConfidenceResult objects produced by the shared
 * Financial and Confidence engines, not a re-derived shape.
 */
export interface CostFindingRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  findingId: string;
  analysisId: string;
  accountId: string;
  instanceId: string;
  instanceType: string;
  region: string;
  findingType: CostFindingType;
  severity: CostFindingSeverity;
  status: CostFindingStatus;
  reason: string;
  tags: Record<string, string>;
  monthlySavings: number;
  currency: string;
  financialImpact: Record<string, unknown>;
  confidence: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class InvalidCostFindingRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCostFindingRecordError';
  }
}

/** Minimal shape validation shared by mock and DynamoDB repositories. */
export function validateCostFindingShape(
  record: Pick<
    CostFindingRecord,
    'tenantId' | 'findingId' | 'analysisId' | 'accountId' | 'instanceId' | 'region'
  >,
): void {
  const requiredFields: Array<[string, string]> = [
    ['tenantId', record.tenantId],
    ['findingId', record.findingId],
    ['analysisId', record.analysisId],
    ['accountId', record.accountId],
    ['instanceId', record.instanceId],
    ['region', record.region],
  ];

  for (const [field, value] of requiredFields) {
    if (!value || !value.trim()) {
      throw new InvalidCostFindingRecordError(`${field} must not be empty.`);
    }
  }
}
