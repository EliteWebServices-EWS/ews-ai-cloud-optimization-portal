/**
 * Membership + invitation persistence.
 *
 * Mirrors orchestrator/workflow.store.ts: DynamoDB-backed repositories are
 * used whenever their table env vars are configured (every deployed
 * environment); an in-memory fallback covers local development and tests
 * without a configured table.
 */

import { dynamoDbDocumentClient } from '../database';
import { isPersistenceEnabled } from '../persistence/persistence-table';
import {
  DynamoDbInvitationRepository,
  DynamoDbMembershipRepository,
} from '../repositories/dynamodb';
import type {
  CreateInvitationInput,
  CreateMembershipInput,
  InvitationRepository,
  MembershipRepository,
  PageRequest,
  PageResult,
  UpdateInvitationInput,
  UpdateMembershipInput,
  UpdateOptions,
} from '../repositories/contracts';
import { normalizePageSize } from '../repositories/contracts/repository-types';
import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../database';
import type { InvitationRecord, MembershipRecord } from '../repositories/models';
import { createLogger } from '../shared/utils';
import { InvitationNotAcceptableError } from '../repositories/dynamodb/dynamodb-invitation-repository';

const logger = createLogger('MembershipStore');

export function shouldUseDurableMembershipStore(): boolean {
  const membershipsTableName = process.env.MEMBERSHIPS_TABLE_NAME?.trim();
  return Boolean(isPersistenceEnabled() && membershipsTableName);
}

export function shouldUseDurableInvitationStore(): boolean {
  const invitationsTableName = process.env.INVITATIONS_TABLE_NAME?.trim();
  return Boolean(isPersistenceEnabled() && invitationsTableName);
}

/**
 * In-memory MembershipRepository. Local-dev / test fallback ONLY.
 */
export class InMemoryMembershipRepository implements MembershipRepository {
  private readonly byKey = new Map<string, MembershipRecord>();
  private readonly byMemberId = new Map<string, string>();

  private static key(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }

  async create(input: CreateMembershipInput): Promise<MembershipRecord> {
    const key = InMemoryMembershipRepository.key(input.tenantId, input.userId);

    if (this.byKey.has(key)) {
      throw new RepositoryAlreadyExistsError(
        `Membership for user ${input.userId} in tenant ${input.tenantId} already exists.`,
      );
    }

    const now = new Date().toISOString();
    const record: MembershipRecord = { ...input, version: 1, createdAt: now, updatedAt: now };

    this.byKey.set(key, record);
    this.byMemberId.set(record.memberId, key);

    return { ...record };
  }

  async get(tenantId: string, userId: string): Promise<MembershipRecord | undefined> {
    const record = this.byKey.get(InMemoryMembershipRepository.key(tenantId, userId));
    return record ? { ...record } : undefined;
  }

  async getByMemberId(memberId: string): Promise<MembershipRecord | undefined> {
    const key = this.byMemberId.get(memberId);
    if (!key) {
      return undefined;
    }
    const record = this.byKey.get(key);
    return record ? { ...record } : undefined;
  }

  async update(
    tenantId: string,
    userId: string,
    changes: UpdateMembershipInput,
    options: UpdateOptions,
  ): Promise<MembershipRecord> {
    const key = InMemoryMembershipRepository.key(tenantId, userId);
    const existing = this.byKey.get(key);

    if (!existing || existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `Membership for user ${userId} in tenant ${tenantId} could not be updated because its version changed or it no longer exists.`,
      );
    }

    const updated: MembershipRecord = {
      ...existing,
      ...changes,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.byKey.set(key, updated);
    return { ...updated };
  }

  async delete(tenantId: string, userId: string, options?: UpdateOptions): Promise<void> {
    const key = InMemoryMembershipRepository.key(tenantId, userId);
    const existing = this.byKey.get(key);

    if (!existing || (options && existing.version !== options.expectedVersion)) {
      throw new RepositoryConflictError(
        `Membership for user ${userId} in tenant ${tenantId} could not be deleted because it does not exist or its version changed.`,
      );
    }

    this.byKey.delete(key);
    this.byMemberId.delete(existing.memberId);
  }

  async listByTenant(tenantId: string, page?: PageRequest): Promise<PageResult<MembershipRecord>> {
    const limit = normalizePageSize(page?.limit);
    const items = Array.from(this.byKey.values())
      .filter((record) => record.tenantId === tenantId)
      .slice(0, limit)
      .map((record) => ({ ...record }));

    return { items };
  }

  async listByUser(userId: string, page?: PageRequest): Promise<PageResult<MembershipRecord>> {
    const limit = normalizePageSize(page?.limit);
    const items = Array.from(this.byKey.values())
      .filter((record) => record.userId === userId)
      .slice(0, limit)
      .map((record) => ({ ...record }));

    return { items };
  }
}

/**
 * In-memory InvitationRepository. Local-dev / test fallback ONLY.
 */
export class InMemoryInvitationRepository implements InvitationRepository {
  private readonly byKey = new Map<string, InvitationRecord>();
  private readonly byTokenHash = new Map<string, string>();

  private static key(tenantId: string, invitationId: string): string {
    return `${tenantId}::${invitationId}`;
  }

  async create(input: CreateInvitationInput): Promise<InvitationRecord> {
    const key = InMemoryInvitationRepository.key(input.tenantId, input.invitationId);

    if (this.byKey.has(key)) {
      throw new RepositoryAlreadyExistsError(
        `Invitation ${input.invitationId} already exists.`,
      );
    }

    const now = new Date().toISOString();
    const record: InvitationRecord = { ...input, version: 1, createdAt: now, updatedAt: now };

    this.byKey.set(key, record);
    this.byTokenHash.set(record.tokenHash, key);

    return { ...record };
  }

  async get(tenantId: string, invitationId: string): Promise<InvitationRecord | undefined> {
    const record = this.byKey.get(InMemoryInvitationRepository.key(tenantId, invitationId));
    return record ? { ...record } : undefined;
  }

  async getByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined> {
    const key = this.byTokenHash.get(tokenHash);
    if (!key) {
      return undefined;
    }
    const record = this.byKey.get(key);
    return record ? { ...record } : undefined;
  }

  async update(
    tenantId: string,
    invitationId: string,
    changes: UpdateInvitationInput,
    options: UpdateOptions,
  ): Promise<InvitationRecord> {
    const key = InMemoryInvitationRepository.key(tenantId, invitationId);
    const existing = this.byKey.get(key);

    if (!existing || existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `Invitation ${invitationId} could not be updated because its version changed or it no longer exists.`,
      );
    }

    const updated: InvitationRecord = {
      ...existing,
      ...changes,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.byKey.set(key, updated);
    return { ...updated };
  }

  async markAccepted(
    tenantId: string,
    invitationId: string,
    input: { acceptedByUserId: string; acceptedAt: string; nowIso: string },
  ): Promise<InvitationRecord> {
    const key = InMemoryInvitationRepository.key(tenantId, invitationId);
    const existing = this.byKey.get(key);

    if (!existing) {
      throw new RepositoryNotFoundError(`Invitation ${invitationId} was not found.`);
    }

    // Single atomic check-and-set within the synchronous JS event loop —
    // equivalent replay protection to the DynamoDB conditional write.
    if (existing.status !== 'PENDING' || existing.expiresAtIso <= input.nowIso) {
      throw new InvitationNotAcceptableError(
        `Invitation ${invitationId} is not pending or has expired; it cannot be accepted (possible replay).`,
      );
    }

    const updated: InvitationRecord = {
      ...existing,
      status: 'ACCEPTED',
      acceptedAt: input.acceptedAt,
      acceptedByUserId: input.acceptedByUserId,
      version: existing.version + 1,
      updatedAt: input.acceptedAt,
    };

    this.byKey.set(key, updated);
    return { ...updated };
  }

  async listByTenant(tenantId: string, page?: PageRequest): Promise<PageResult<InvitationRecord>> {
    const limit = normalizePageSize(page?.limit);
    const items = Array.from(this.byKey.values())
      .filter((record) => record.tenantId === tenantId)
      .slice(0, limit)
      .map((record) => ({ ...record }));

    return { items };
  }
}

let sharedMembershipRepository: MembershipRepository | undefined;
let sharedInvitationRepository: InvitationRepository | undefined;

export function createMembershipRepository(): MembershipRepository {
  if (shouldUseDurableMembershipStore()) {
    const tableName = process.env.MEMBERSHIPS_TABLE_NAME!.trim();
    return new DynamoDbMembershipRepository(dynamoDbDocumentClient, tableName);
  }

  logger.warn(
    'MEMBERSHIPS_TABLE_NAME is not configured; using in-memory membership storage. ' +
      'This is only safe for local development and tests.',
    { operation: 'createMembershipRepository', status: 'fallback' },
  );

  return new InMemoryMembershipRepository();
}

export function createInvitationRepository(): InvitationRepository {
  if (shouldUseDurableInvitationStore()) {
    const tableName = process.env.INVITATIONS_TABLE_NAME!.trim();
    return new DynamoDbInvitationRepository(dynamoDbDocumentClient, tableName);
  }

  logger.warn(
    'INVITATIONS_TABLE_NAME is not configured; using in-memory invitation storage. ' +
      'This is only safe for local development and tests.',
    { operation: 'createInvitationRepository', status: 'fallback' },
  );

  return new InMemoryInvitationRepository();
}

/** Lazily-created singletons shared across the Lambda execution environment. */
export function getSharedMembershipRepository(): MembershipRepository {
  if (!sharedMembershipRepository) {
    sharedMembershipRepository = createMembershipRepository();
  }
  return sharedMembershipRepository;
}

export function getSharedInvitationRepository(): InvitationRepository {
  if (!sharedInvitationRepository) {
    sharedInvitationRepository = createInvitationRepository();
  }
  return sharedInvitationRepository;
}

/** Test-only reset hook. */
export function resetSharedMembershipStores(): void {
  sharedMembershipRepository = undefined;
  sharedInvitationRepository = undefined;
}
