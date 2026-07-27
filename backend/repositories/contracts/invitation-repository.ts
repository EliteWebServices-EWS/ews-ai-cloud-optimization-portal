import type { PageRequest, PageResult, UpdateOptions } from './repository-types';

import type { InvitationRecord } from '../models';

export type CreateInvitationInput = Omit<
  InvitationRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateInvitationInput = Partial<
  Omit<
    InvitationRecord,
    | 'tenantId'
    | 'invitationId'
    | 'tokenHash'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface InvitationRepository {
  create(input: CreateInvitationInput): Promise<InvitationRecord>;

  get(
    tenantId: string,
    invitationId: string,
  ): Promise<InvitationRecord | undefined>;

  /**
   * Resolve an invitation by the SHA-256 hash of its bearer token. Used to
   * process acceptance without exposing tenantId/invitationId in the URL.
   */
  getByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined>;

  update(
    tenantId: string,
    invitationId: string,
    changes: UpdateInvitationInput,
    options: UpdateOptions,
  ): Promise<InvitationRecord>;

  /**
   * Atomically transition a PENDING invitation to ACCEPTED, guarding against
   * replay: the conditional write only succeeds if the invitation is still
   * PENDING and has not expired at the time of the call.
   */
  markAccepted(
    tenantId: string,
    invitationId: string,
    input: { acceptedByUserId: string; acceptedAt: string; nowIso: string },
  ): Promise<InvitationRecord>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<InvitationRecord>>;
}
