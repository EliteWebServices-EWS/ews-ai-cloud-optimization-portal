import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { InvalidPaginationTokenError } from '../../database';
import { buildTenantPartitionKey } from '../../persistence/persistence-table';
import { createFakePersistenceTable } from './support/fake-persistence-table';

describe('PersistenceTable.queryPageByPrefix', () => {
  it('returns bounded pages with tenant-scoped tokens', async () => {
    const table = createFakePersistenceTable();
    const pk = buildTenantPartitionKey('tenant-a');

    for (let index = 0; index < 5; index += 1) {
      await table.putItem({
        pk,
        sk: `REPORT#rpt-${index}`,
        entityType: 'report',
        data: { reportId: `rpt-${index}` },
      });
    }

    const first = await table.queryPageByPrefix({
      pk,
      skPrefix: 'REPORT#',
      limit: 2,
      paginationContext: { tenantId: 'tenant-a', scope: 'reports:list' },
    });

    assert.equal(first.items.length, 2);
    assert.ok(first.nextToken);

    const second = await table.queryPageByPrefix({
      pk,
      skPrefix: 'REPORT#',
      limit: 2,
      nextToken: first.nextToken,
      paginationContext: { tenantId: 'tenant-a', scope: 'reports:list' },
    });

    assert.equal(second.items.length, 2);
    assert.ok(second.nextToken);

    const third = await table.queryPageByPrefix({
      pk,
      skPrefix: 'REPORT#',
      limit: 2,
      nextToken: second.nextToken,
      paginationContext: { tenantId: 'tenant-a', scope: 'reports:list' },
    });

    assert.equal(third.items.length, 1);
    assert.equal(third.nextToken, undefined);
  });

  it('rejects tokens from a different tenant scope', async () => {
    const table = createFakePersistenceTable();
    const pk = buildTenantPartitionKey('tenant-a');

    await table.putItem({ pk, sk: 'REPORT#one', entityType: 'report' });
    await table.putItem({ pk, sk: 'REPORT#two', entityType: 'report' });
    await table.putItem({ pk, sk: 'REPORT#three', entityType: 'report' });

    const page = await table.queryPageByPrefix({
      pk,
      skPrefix: 'REPORT#',
      limit: 1,
      paginationContext: { tenantId: 'tenant-a', scope: 'reports:list' },
    });

    await assert.rejects(
      () =>
        table.queryPageByPrefix({
          pk,
          skPrefix: 'REPORT#',
          limit: 1,
          nextToken: page.nextToken,
          paginationContext: { tenantId: 'tenant-b', scope: 'reports:list' },
        }),
      InvalidPaginationTokenError
    );
  });
});
