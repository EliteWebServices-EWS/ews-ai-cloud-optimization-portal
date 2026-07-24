import { OWNERSHIP_SORT_KEY } from '../database/dynamodb-keys';
import { OwnershipConflictError } from '../database';

import type { PersistenceTable, PersistedItem } from './persistence-table';

const SAME_OWNER_CONDITION =
  'attribute_not_exists(pk) OR ownerTenantId = :owner OR tenantId = :owner';

function readOwnerTenantId(item: PersistedItem | undefined): string | undefined {
  if (!item) {
    return undefined;
  }

  const ownerTenantId = item.ownerTenantId;
  if (typeof ownerTenantId === 'string' && ownerTenantId.length > 0) {
    return ownerTenantId;
  }

  const tenantId = item.tenantId;
  if (typeof tenantId === 'string' && tenantId.length > 0) {
    return tenantId;
  }

  return undefined;
}

export interface EngineOwnershipWriteInput {
  pk: string;
  entityType: string;
  ownerTenantId: string;
  expiresAt?: number;
}

/**
 * Authoritative engine-layer ownership write:
 * - create when missing;
 * - idempotent when the same tenant already owns the resource;
 * - conflict when another tenant owns the resource.
 */
export async function ensureEngineOwnership(
  ownershipTable: PersistenceTable,
  input: EngineOwnershipWriteInput,
): Promise<void> {
  const existing = await ownershipTable.getItem(input.pk, OWNERSHIP_SORT_KEY);
  const existingOwner = readOwnerTenantId(existing);

  if (existingOwner && existingOwner !== input.ownerTenantId) {
    throw new OwnershipConflictError();
  }

  if (existingOwner === input.ownerTenantId) {
    return;
  }

  const item: PersistedItem = {
    pk: input.pk,
    sk: OWNERSHIP_SORT_KEY,
    entityType: input.entityType,
    ownerTenantId: input.ownerTenantId,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  };

  try {
    await ownershipTable.putItemConditional(item, {
      conditionExpression:
        'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    });
  } catch (error) {
    if (error instanceof OwnershipConflictError) {
      throw error;
    }

    const afterRace = await ownershipTable.getItem(input.pk, OWNERSHIP_SORT_KEY);
    const racedOwner = readOwnerTenantId(afterRace);

    if (racedOwner === input.ownerTenantId) {
      return;
    }

    if (racedOwner && racedOwner !== input.ownerTenantId) {
      throw new OwnershipConflictError();
    }

    throw error;
  }
}

export function resolveEngineOwnershipTenantId(
  item: PersistedItem | undefined,
): string | undefined {
  return readOwnerTenantId(item);
}

export function buildSameOwnerConditionValues(
  ownerTenantId: string,
): Record<string, unknown> {
  return { ':owner': ownerTenantId };
}

export { SAME_OWNER_CONDITION };
