import type {
  TenantRecordIdentity,
  VersionedRecord,
} from '../contracts/repository-types';

import type { TenantRole } from '../../auth/tenant-roles';

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

/**
 * Tenant membership lifecycle status.
 *
 *  PENDING     — created by an accepted invitation flow that has not yet
 *                completed acceptance, or a direct add awaiting activation.
 *  ACTIVE      — member has full access implied by `role`.
 *  SUSPENDED   — access temporarily revoked; membership record retained.
 *  REMOVED     — member has been removed from the tenant (terminal).
 */
export type MembershipStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REMOVED';

export interface MembershipRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  memberId: string;
  userId: string;
  role: TenantRole;
  status: MembershipStatus;
  joinedAt: string;
  invitedBy?: string;
  invitationId?: string;
  statusChangedAt: string;
  statusChangedBy?: string;
  expiresAt?: number;
}

/**
 * Invitation lifecycle status.
 *
 *  PENDING    — token issued, not yet consumed, not yet expired.
 *  ACCEPTED   — token was consumed exactly once to create/activate a
 *               membership (terminal; replay is rejected).
 *  EXPIRED    — expiresAt has passed without acceptance.
 *  CANCELLED  — revoked by an administrator before acceptance (terminal).
 */
export type InvitationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface InvitationRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  invitationId: string;
  email: string;
  role: TenantRole;
  status: InvitationStatus;
  /** SHA-256 hex digest of the invitation token. The raw token is never persisted. */
  tokenHash: string;
  /** ISO-8601 expiration timestamp used for logical expiry checks. */
  expiresAtIso: string;
  /** Epoch-seconds DynamoDB TTL attribute — cleans up long-expired invitations. */
  expiresAt: number;
  invitedBy: string;
  acceptedAt?: string;
  acceptedByUserId?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}