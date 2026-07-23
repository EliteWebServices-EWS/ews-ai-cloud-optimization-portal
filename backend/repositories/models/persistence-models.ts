import type {
  TenantRecordIdentity,
  VersionedRecord,
} from '../contracts/repository-types';

export type WorkflowStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export interface WorkflowRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  workflowId: string;
  status: WorkflowStatus;
  provider: string;
  resourceId?: string;
  region?: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  idempotencyKey?: string;
  expiresAt?: number;
}

export interface ReportRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  reportId: string;
  workflowId: string;
  reportType: string;
  status: string;
  title?: string;
  content?: Record<string, unknown>;
  expiresAt?: number;
}

export interface LearningRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  learningId: string;
  workflowId?: string;
  feedbackType: string;
  payload?: Record<string, unknown>;
  expiresAt?: number;
}

export interface VerificationRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  verificationId: string;
  workflowId?: string;
  outcome: string;
  payload?: Record<string, unknown>;
  expiresAt?: number;
}

export type OwnershipResourceType =
  | 'WORKFLOW'
  | 'REPORT'
  | 'LEARNING'
  | 'VERIFICATION';

export interface OwnershipRecord extends VersionedRecord {
  resourceType: OwnershipResourceType;
  resourceId: string;
  ownerTenantId: string;
  expiresAt?: number;
}