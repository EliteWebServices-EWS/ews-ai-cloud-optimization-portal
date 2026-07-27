import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
} from '../../database';

import {
  DynamoDbTenantRepository,
} from '../../repositories/dynamodb/dynamodb-tenant-repository';

import type {
  TenantRecord,
} from '../../repositories/models';

type CommandHandler = (
  command:
    | GetCommand
    | QueryCommand
    | TransactWriteCommand
    | UpdateCommand,
) => Promise<Record<string, unknown>>;

function createClient(
  handler: CommandHandler,
): DynamoDBDocumentClient {
  return {
    send: handler,
  } as unknown as DynamoDBDocumentClient;
}

function createTenantInput() {
  return {
    tenantId: 'tenant-001',
    organizationName: 'Elite Web Services',
    displayName: 'EWS',
    slug: 'Elite-Web-Services',
    ownerUserId: 'user-001',
    primaryContact: {
      name: 'Florence',
      email: 'florence@example.com',
    },
    status: 'PROVISIONING' as const,
    region: 'us-east-1',
    subscriptionPlan: 'STANDARD',
    metadata: {
      source: 'test',
    },
  };
}

function createStoredTenant(
  overrides: Partial<TenantRecord> = {},
): TenantRecord {
  return {
    ...createTenantInput(),
    slug: 'elite-web-services',
    version: 1,
    createdAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    ...overrides,
  };
}

test('creates a tenant with version 1 and normalized slug', async () => {
  let capturedCommand:
    | TransactWriteCommand
    | undefined;

  const client = createClient(async (command) => {
    assert.ok(
      command instanceof TransactWriteCommand,
    );

    capturedCommand = command;

    return {};
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result = await repository.create(
    createTenantInput(),
  );

  assert.equal(result.version, 1);
  assert.equal(result.slug, 'elite-web-services');
  assert.equal(result.tenantId, 'tenant-001');

  assert.ok(capturedCommand);

  const transactionItems =
    capturedCommand.input.TransactItems ?? [];

  assert.equal(transactionItems.length, 2);
});

test('rejects duplicate tenant ID or slug', async () => {
  const client = createClient(async () => {
    const error = new Error(
      'Transaction cancelled',
    );

    error.name = 'TransactionCanceledException';

    throw error;
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  await assert.rejects(
    repository.create(createTenantInput()),
    RepositoryAlreadyExistsError,
  );
});

test('gets a tenant by ID', async () => {
  const stored = createStoredTenant();

  const client = createClient(async (command) => {
    assert.ok(command instanceof GetCommand);

    return {
      Item: {
        pk: 'TENANT#tenant-001',
        sk: 'TENANT',
        entityType: 'TENANT',
        gsi1pk:
          'TENANT_SLUG#elite-web-services',
        gsi1sk: 'TENANT#tenant-001',
        gsi2pk: 'TENANT_OWNER#user-001',
        gsi2sk:
          'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
        gsi3pk:
          'TENANT_STATUS#PROVISIONING',
        gsi3sk:
          'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
        ...stored,
      },
    };
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result =
    await repository.getById('tenant-001');

  assert.ok(result);
  assert.equal(result?.tenantId, 'tenant-001');
  assert.equal(
    result?.slug,
    'elite-web-services',
  );
});

test('returns undefined when tenant ID does not exist', async () => {
  const client = createClient(async () => {
    return {};
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result =
    await repository.getById('missing');

  assert.equal(result, undefined);
});

test('gets a tenant by normalized slug', async () => {
  const stored = createStoredTenant();

  const client = createClient(async (command) => {
    assert.ok(command instanceof QueryCommand);

    assert.equal(
      command.input.IndexName,
      'gsi1',
    );

    assert.deepEqual(
      command.input.ExpressionAttributeValues,
      {
        ':gsi1pk':
          'TENANT_SLUG#elite-web-services',
      },
    );

    return {
      Items: [
        {
          pk: 'TENANT#tenant-001',
          sk: 'TENANT',
          entityType: 'TENANT',
          gsi1pk:
            'TENANT_SLUG#elite-web-services',
          gsi1sk: 'TENANT#tenant-001',
          gsi2pk: 'TENANT_OWNER#user-001',
          gsi2sk:
            'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
          gsi3pk:
            'TENANT_STATUS#PROVISIONING',
          gsi3sk:
            'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
          ...stored,
        },
      ],
    };
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result =
    await repository.getBySlug(
      'Elite-Web-Services',
    );

  assert.ok(result);
  assert.equal(
    result?.slug,
    'elite-web-services',
  );
});

test('updates a tenant using optimistic locking', async () => {
  const updated = createStoredTenant({
    displayName: 'Elite Web Services',
    version: 2,
  });

  const client = createClient(async (command) => {
    assert.ok(command instanceof UpdateCommand);

    assert.equal(
      command.input.ConditionExpression,
      'attribute_exists(pk) AND #version = :expectedVersion',
    );

    return {
      Attributes: {
        pk: 'TENANT#tenant-001',
        sk: 'TENANT',
        entityType: 'TENANT',
        gsi1pk:
          'TENANT_SLUG#elite-web-services',
        gsi1sk: 'TENANT#tenant-001',
        gsi2pk: 'TENANT_OWNER#user-001',
        gsi2sk:
          'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
        gsi3pk:
          'TENANT_STATUS#PROVISIONING',
        gsi3sk:
          'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
        ...updated,
      },
    };
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result = await repository.update(
    'tenant-001',
    {
      displayName: 'Elite Web Services',
    },
    {
      expectedVersion: 1,
    },
  );

  assert.equal(result.version, 2);
  assert.equal(
    result.displayName,
    'Elite Web Services',
  );
});

test('rejects stale version updates', async () => {
  const client = createClient(async () => {
    const error = new Error(
      'Conditional request failed',
    );

    error.name =
      'ConditionalCheckFailedException';

    throw error;
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  await assert.rejects(
    repository.update(
      'tenant-001',
      {
        displayName: 'New name',
      },
      {
        expectedVersion: 1,
      },
    ),
    RepositoryConflictError,
  );
});

test('allows a valid status transition', async () => {
  let callCount = 0;

  const client = createClient(async (command) => {
    callCount += 1;

    if (command instanceof GetCommand) {
      return {
        Item: {
          pk: 'TENANT#tenant-001',
          sk: 'TENANT',
          entityType: 'TENANT',
          gsi1pk:
            'TENANT_SLUG#elite-web-services',
          gsi1sk: 'TENANT#tenant-001',
          gsi2pk: 'TENANT_OWNER#user-001',
          gsi2sk:
            'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
          gsi3pk:
            'TENANT_STATUS#PROVISIONING',
          gsi3sk:
            'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
          ...createStoredTenant(),
        },
      };
    }

    assert.ok(command instanceof UpdateCommand);

    return {
      Attributes: {
        pk: 'TENANT#tenant-001',
        sk: 'TENANT',
        entityType: 'TENANT',
        gsi1pk:
          'TENANT_SLUG#elite-web-services',
        gsi1sk: 'TENANT#tenant-001',
        gsi2pk: 'TENANT_OWNER#user-001',
        gsi2sk:
          'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
        gsi3pk:
          'TENANT_STATUS#ACTIVE',
        gsi3sk:
          'CREATED_AT#2026-07-25T10:00:00.000Z#TENANT#tenant-001',
        ...createStoredTenant({
          status: 'ACTIVE',
          version: 2,
        }),
      },
    };
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result =
    await repository.transitionStatus(
      'tenant-001',
      'ACTIVE',
      {
        expectedVersion: 1,
      },
    );

  assert.equal(callCount, 2);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.version, 2);
});

test('lists tenants by owner using gsi2', async () => {
  const client = createClient(async (command) => {
    assert.ok(command instanceof QueryCommand);

    assert.equal(
      command.input.IndexName,
      'gsi2',
    );

    return {
      Items: [],
    };
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result =
    await repository.listByOwner(
      'user-001',
      {
        limit: 10,
      },
    );

  assert.deepEqual(result.items, []);
});

test('lists tenants by status using gsi3', async () => {
  const client = createClient(async (command) => {
    assert.ok(command instanceof QueryCommand);

    assert.equal(
      command.input.IndexName,
      'gsi3',
    );

    return {
      Items: [],
    };
  });

  const repository = new DynamoDbTenantRepository(
    client,
    'sisum-tenants-test',
  );

  const result =
    await repository.listByStatus(
      'ACTIVE',
      {
        limit: 10,
      },
    );

  assert.deepEqual(result.items, []);
});