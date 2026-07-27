/**
 * Tenant membership + invitation lifecycle service.
 *
 * Supported lifecycle actions (Task 4): Invite, Accept, Suspend, Reactivate,
 * Remove — plus direct member add and role (re)assignment (Task 3).
 *
 * This module contains the business rules; api/routes/membership-routes.ts
 * is a thin HTTP adapter over it.
 */

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../database';
import type {
  InvitationRepository,
  MembershipRepository,
} from '../repositories/contracts';
import type {
  InvitationRecord,
  InvitationStatus,
  MembershipRecord,
  MembershipStatus,
} from '../repositories/models';
import { AppError } from '../shared/utils';
import { ALL_TENANT_ROLES, isTenantRole, type TenantRole } from '../auth/tenant-roles';
import { InvitationNotAcceptableError } from '../repositories/dynamodb/dynamodb-invitation-repository';
import {
  generateInvitationId,
  generateInvitationToken,
  generateMemberId,
  hashInvitationToken,
} from './membership.token';

/** Default invitation lifetime. */
const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Extra retention window after logical expiry before DynamoDB TTL sweeps the item. */
const INVITATION_TTL_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface MembershipServiceDeps {
  membershipRepository: MembershipRepository;
  invitationRepository: InvitationRepository;
}

export interface InviteMemberInput {
  tenantId: string;
  email: string;
  role: TenantRole;
  invitedBy: string;
}

export interface InviteMemberResult {
  invitation: InvitationRecord;
  /** Raw bearer token — returned exactly once, never persisted. */
  token: string;
}

export interface AcceptInvitationInput {
  token: string;
  acceptingUserId: string;
}

export interface AddMemberInput {
  tenantId: string;
  userId: string;
  role: TenantRole;
  addedBy: string;
  status?: Extract<MembershipStatus, 'ACTIVE' | 'PENDING'>;
}

export interface UpdateMemberInput {
  memberId: string;
  role?: TenantRole;
  status?: Extract<MembershipStatus, 'ACTIVE' | 'SUSPENDED'>;
  actorUserId?: string;
  expectedVersion?: number;
}

function requireValidRole(role: string): asserts role is TenantRole {
  if (!isTenantRole(role)) {
    throw new AppError(
      'INVALID_ROLE',
      `role must be one of: ${ALL_TENANT_ROLES.join(', ')}`,
      400,
    );
  }
}

function requireValidEmail(email: string): void {
  const trimmed = email.trim();
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  if (!trimmed || !isValid) {
    throw new AppError('INVALID_EMAIL', 'A valid email address is required.', 400);
  }
}

export class MembershipService {
  private readonly membershipRepository: MembershipRepository;
  private readonly invitationRepository: InvitationRepository;

  constructor(deps: MembershipServiceDeps) {
    this.membershipRepository = deps.membershipRepository;
    this.invitationRepository = deps.invitationRepository;
  }

  // ---------------------------------------------------------------------
  // Task 1 / Task 5: direct membership management
  // ---------------------------------------------------------------------

  /** POST /tenants/{tenantId}/members */
  async addMember(input: AddMemberInput): Promise<MembershipRecord> {
    requireValidRole(input.role);

    const existing = await this.membershipRepository.get(input.tenantId, input.userId);
    if (existing) {
      throw new AppError(
        'MEMBER_ALREADY_EXISTS',
        `User ${input.userId} is already a member of this tenant.`,
        409,
      );
    }

    const now = new Date().toISOString();

    try {
      return await this.membershipRepository.create({
        tenantId: input.tenantId,
        memberId: generateMemberId(),
        userId: input.userId,
        role: input.role,
        status: input.status ?? 'ACTIVE',
        joinedAt: now,
        statusChangedAt: now,
        statusChangedBy: input.addedBy,
        invitedBy: input.addedBy,
      });
    } catch (error) {
      if (error instanceof RepositoryAlreadyExistsError) {
        throw new AppError('MEMBER_ALREADY_EXISTS', error.message, 409);
      }
      throw error;
    }
  }

  async getMemberById(memberId: string): Promise<MembershipRecord> {
    const record = await this.membershipRepository.getByMemberId(memberId);

    if (!record) {
      throw new AppError('MEMBER_NOT_FOUND', `Member ${memberId} was not found.`, 404);
    }

    return record;
  }

  async listMembers(tenantId: string, limit?: number, nextToken?: string) {
    return this.membershipRepository.listByTenant(tenantId, { limit, nextToken });
  }

  /**
   * PATCH /members/{memberId} — role (re)assignment, suspend, or reactivate.
   * Task 3: role assignment. Task 4: Suspend / Reactivate lifecycle.
   */
  async updateMember(input: UpdateMemberInput): Promise<MembershipRecord> {
    const current = await this.getMemberById(input.memberId);

    if (current.status === 'REMOVED') {
      throw new AppError(
        'MEMBER_REMOVED',
        `Member ${input.memberId} has been removed and can no longer be updated.`,
        409,
      );
    }

    if (input.role !== undefined) {
      requireValidRole(input.role);
    }

    if (input.status !== undefined) {
      this.assertValidStatusTransition(current.status, input.status);
    }

    const expectedVersion = input.expectedVersion ?? current.version;
    const now = new Date().toISOString();

    const changes: Parameters<MembershipRepository['update']>[2] = {};

    if (input.role !== undefined) {
      changes.role = input.role;
    }

    if (input.status !== undefined) {
      changes.status = input.status;
      changes.statusChangedAt = now;
      changes.statusChangedBy = input.actorUserId;
    }

    try {
      return await this.membershipRepository.update(
        current.tenantId,
        current.userId,
        changes,
        { expectedVersion },
      );
    } catch (error) {
      if (error instanceof RepositoryConflictError) {
        throw new AppError('MEMBER_VERSION_CONFLICT', error.message, 409);
      }
      if (error instanceof RepositoryNotFoundError) {
        throw new AppError('MEMBER_NOT_FOUND', error.message, 404);
      }
      throw error;
    }
  }

  /**
   * DELETE /members/{memberId} — Task 4 "Remove" lifecycle action.
   *
   * Soft-removes the membership (status -> REMOVED) rather than deleting
   * the record outright, preserving membership history for audit purposes.
   */
  async removeMember(memberId: string, actorUserId?: string, expectedVersion?: number): Promise<MembershipRecord> {
    const current = await this.getMemberById(memberId);

    if (current.status === 'REMOVED') {
      return current;
    }

    const now = new Date().toISOString();

    try {
      return await this.membershipRepository.update(
        current.tenantId,
        current.userId,
        {
          status: 'REMOVED',
          statusChangedAt: now,
          statusChangedBy: actorUserId,
        },
        { expectedVersion: expectedVersion ?? current.version },
      );
    } catch (error) {
      if (error instanceof RepositoryConflictError) {
        throw new AppError('MEMBER_VERSION_CONFLICT', error.message, 409);
      }
      if (error instanceof RepositoryNotFoundError) {
        throw new AppError('MEMBER_NOT_FOUND', error.message, 404);
      }
      throw error;
    }
  }

  private assertValidStatusTransition(
    from: MembershipStatus,
    to: MembershipStatus,
  ): void {
    const allowed: Record<MembershipStatus, readonly MembershipStatus[]> = {
      PENDING: ['ACTIVE', 'REMOVED'],
      ACTIVE: ['SUSPENDED', 'REMOVED'],
      SUSPENDED: ['ACTIVE', 'REMOVED'],
      REMOVED: [],
    };

    if (!allowed[from].includes(to)) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        `Membership cannot transition from ${from} to ${to}.`,
        409,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Task 2 / Task 4: invitation lifecycle
  // ---------------------------------------------------------------------

  /** POST /tenants/{tenantId}/invite — Task 4 "Invite" lifecycle action. */
  async inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
    requireValidRole(input.role);
    requireValidEmail(input.email);

    const now = new Date();
    const expiresAtDate = new Date(now.getTime() + DEFAULT_INVITATION_TTL_MS);
    const ttlDate = new Date(expiresAtDate.getTime() + INVITATION_TTL_GRACE_MS);

    const token = generateInvitationToken();
    const tokenHash = hashInvitationToken(token);

    const invitation = await this.invitationRepository.create({
      tenantId: input.tenantId,
      invitationId: generateInvitationId(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      status: 'PENDING',
      tokenHash,
      expiresAtIso: expiresAtDate.toISOString(),
      expiresAt: Math.floor(ttlDate.getTime() / 1000),
      invitedBy: input.invitedBy,
    });

    return { invitation, token };
  }

  async listInvitations(tenantId: string, limit?: number, nextToken?: string) {
    return this.invitationRepository.listByTenant(tenantId, { limit, nextToken });
  }

  /** POST /tenants/{tenantId}/invitations/{invitationId}/cancel */
  async cancelInvitation(
    tenantId: string,
    invitationId: string,
    cancelledBy: string,
  ): Promise<InvitationRecord> {
    const existing = await this.invitationRepository.get(tenantId, invitationId);

    if (!existing) {
      throw new AppError('INVITATION_NOT_FOUND', `Invitation ${invitationId} was not found.`, 404);
    }

    if (existing.status !== 'PENDING') {
      throw new AppError(
        'INVITATION_NOT_CANCELLABLE',
        `Invitation ${invitationId} is ${existing.status.toLowerCase()} and cannot be cancelled.`,
        409,
      );
    }

    const now = new Date().toISOString();

    return this.invitationRepository.update(
      tenantId,
      invitationId,
      { status: 'CANCELLED', cancelledAt: now, cancelledBy },
      { expectedVersion: existing.version },
    );
  }

  /**
   * Accept an invitation by its bearer token — Task 4 "Accept" lifecycle
   * action, and Task 2 replay prevention.
   *
   * Resolution is by token hash only (never by tenantId/invitationId taken
   * from client input), and the transition is a single atomic conditional
   * write so a token can be consumed exactly once.
   */
  async acceptInvitation(input: AcceptInvitationInput): Promise<MembershipRecord> {
    const tokenHash = hashInvitationToken(input.token);
    const invitation = await this.invitationRepository.getByTokenHash(tokenHash);

    if (!invitation) {
      throw new AppError('INVITATION_NOT_FOUND', 'This invitation link is not valid.', 404);
    }

    this.assertInvitationCurrentStatus(invitation);

    const nowIso = new Date().toISOString();

    let accepted: InvitationRecord;
    try {
      accepted = await this.invitationRepository.markAccepted(
        invitation.tenantId,
        invitation.invitationId,
        { acceptedByUserId: input.acceptingUserId, acceptedAt: nowIso, nowIso },
      );
    } catch (error) {
      if (error instanceof InvitationNotAcceptableError) {
        throw new AppError(
          'INVITATION_ALREADY_CONSUMED',
          'This invitation has already been accepted, cancelled, or has expired.',
          409,
        );
      }
      if (error instanceof RepositoryNotFoundError) {
        throw new AppError('INVITATION_NOT_FOUND', 'This invitation link is not valid.', 404);
      }
      throw error;
    }

    return this.activateMembershipFromInvitation(accepted, input.acceptingUserId);
  }

  private assertInvitationCurrentStatus(invitation: InvitationRecord): void {
    if (invitation.status === 'ACCEPTED') {
      throw new AppError(
        'INVITATION_ALREADY_CONSUMED',
        'This invitation has already been accepted.',
        409,
      );
    }

    if (invitation.status === 'CANCELLED') {
      throw new AppError('INVITATION_CANCELLED', 'This invitation has been cancelled.', 409);
    }

    if (
      invitation.status === 'EXPIRED' ||
      invitation.expiresAtIso <= new Date().toISOString()
    ) {
      throw new AppError('INVITATION_EXPIRED', 'This invitation has expired.', 409);
    }
  }

  private async activateMembershipFromInvitation(
    invitation: InvitationRecord,
    userId: string,
  ): Promise<MembershipRecord> {
    const now = new Date().toISOString();
    const existing = await this.membershipRepository.get(invitation.tenantId, userId);

    if (!existing) {
      return this.membershipRepository.create({
        tenantId: invitation.tenantId,
        memberId: generateMemberId(),
        userId,
        role: invitation.role,
        status: 'ACTIVE',
        joinedAt: now,
        statusChangedAt: now,
        statusChangedBy: userId,
        invitedBy: invitation.invitedBy,
        invitationId: invitation.invitationId,
      });
    }

    if (existing.status === 'REMOVED') {
      throw new AppError(
        'MEMBER_REMOVED',
        'This user was previously removed from the tenant and cannot self-reactivate via invitation.',
        409,
      );
    }

    return this.membershipRepository.update(
      invitation.tenantId,
      userId,
      {
        role: invitation.role,
        status: 'ACTIVE',
        statusChangedAt: now,
        statusChangedBy: userId,
        invitationId: invitation.invitationId,
      },
      { expectedVersion: existing.version },
    );
  }

  /** Lazily marks an individually-fetched invitation EXPIRED for display purposes. */
  resolveInvitationStatus(invitation: InvitationRecord): InvitationStatus {
    if (invitation.status === 'PENDING' && invitation.expiresAtIso <= new Date().toISOString()) {
      return 'EXPIRED';
    }
    return invitation.status;
  }
}

export function createMembershipService(deps: MembershipServiceDeps): MembershipService {
  return new MembershipService(deps);
}
