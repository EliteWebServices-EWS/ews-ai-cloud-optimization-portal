import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  BaseDynamoDbRepository,
} from '../../../repositories/dynamodb/base-dynamodb-repository';

class TestRepository extends BaseDynamoDbRepository {
  constructor(tableName = 'test-table') {
    super({} as DynamoDBDocumentClient, tableName);
  }

  public buildUpdate(
    changes: Record<string, unknown>,
    expectedVersion: number,
  ) {
    return this.buildVersionedUpdateExpression(
      changes,
      expectedVersion,
    );
  }
}

describe('BaseDynamoDbRepository', () => {
  it('rejects an empty table name', () => {
    assert.throws(
      () => new TestRepository(''),
      /table name must not be empty/,
    );
  });

  it('builds a versioned update expression', () => {
    const repository = new TestRepository();

    const result = repository.buildUpdate(
      {
        status: 'COMPLETED',
      },
      2,
    );

    assert.match(
      result.updateExpression,
      /#version = #version \+ :one/,
    );

    assert.equal(
      result.expressionAttributeValues[':expectedVersion'],
      2,
    );

    assert.equal(
      result.expressionAttributeValues[':value0'],
      'COMPLETED',
    );
  });

  it('ignores undefined fields', () => {
    const repository = new TestRepository();

    const result = repository.buildUpdate(
      {
        status: undefined,
        region: 'us-east-1',
      },
      1,
    );

    assert.equal(
      Object.values(
        result.expressionAttributeNames,
      ).includes('status'),
      false,
    );

    assert.equal(
      Object.values(
        result.expressionAttributeNames,
      ).includes('region'),
      true,
    );
  });

  it('rejects protected fields', () => {
    const repository = new TestRepository();

    assert.throws(
      () =>
        repository.buildUpdate(
          {
            tenantId: 'tenant-b',
          },
          1,
        ),
      /tenantId cannot be updated/,
    );
  });

  it('rejects an invalid expected version', () => {
    const repository = new TestRepository();

    assert.throws(
      () =>
        repository.buildUpdate(
          {
            status: 'FAILED',
          },
          0,
        ),
      /expectedVersion must be a positive integer/,
    );
  });
});