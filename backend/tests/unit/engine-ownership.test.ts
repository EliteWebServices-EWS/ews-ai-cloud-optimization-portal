import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OwnershipConflictError } from '../../database';
import { ownershipPartitionKey, OWNERSHIP_SORT_KEY } from '../../database/dynamodb-keys';
import { ensureEngineOwnership } from '../../persistence/engine-ownership';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

describe('ensureEngineOwnership', () => {
  it('creates ownership on first write', async () => {
    const { ownership } = createLinkedFakePersistenceTables();

    await ensureEngineOwnership(ownership, {
      pk: ownershipPartitionKey('REPORT', 'rpt-1'),
      entityType: 'report-owner-index',
      ownerTenantId: 'tenant-a',
    });

    const item = await ownership.getItem(
      ownershipPartitionKey('REPORT', 'rpt-1'),
      OWNERSHIP_SORT_KEY
    );
    assert.equal(item?.ownerTenantId, 'tenant-a');
  });

  it('allows same-tenant replay', async () => {
    const { ownership } = createLinkedFakePersistenceTables();
    const input = {
      pk: ownershipPartitionKey('WORKFLOW', 'wf-1'),
      entityType: 'workflow-owner-index',
      ownerTenantId: 'tenant-a',
    };

    await ensureEngineOwnership(ownership, input);
    await ensureEngineOwnership(ownership, input);
  });

  it('rejects a different tenant conflict and preserves the original owner', async () => {
    const { ownership } = createLinkedFakePersistenceTables();
    const pk = ownershipPartitionKey('REPORT', 'rpt-conflict');

    await ensureEngineOwnership(ownership, {
      pk,
      entityType: 'report-owner-index',
      ownerTenantId: 'tenant-a',
    });

    await assert.rejects(
      () =>
        ensureEngineOwnership(ownership, {
          pk,
          entityType: 'report-owner-index',
          ownerTenantId: 'tenant-b',
        }),
      OwnershipConflictError
    );

    const item = await ownership.getItem(pk, OWNERSHIP_SORT_KEY);
    assert.equal(item?.ownerTenantId, 'tenant-a');
  });
});
