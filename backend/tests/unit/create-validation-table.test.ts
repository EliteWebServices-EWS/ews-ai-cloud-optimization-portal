import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

import {
  createValidationTable,
  parseCreateValidationTableEnv,
  type CreateValidationTableOptions,
} from '../../scripts/lib/create-validation-table';

const baseOptions: CreateValidationTableOptions = {
  tableName: 'sisum-sprint11-validation',
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
};

function resourceInUseError(): Error {
  const error = new Error('Table already exists');
  error.name = 'ResourceInUseException';
  return error;
}

function mockClient(handlers: {
  onCreate?: () => Promise<unknown>;
  onDescribe?: () => Promise<unknown>;
}): DynamoDBClient {
  return {
    send: async (command: unknown) => {
      if (command instanceof CreateTableCommand) {
        if (handlers.onCreate) {
          return handlers.onCreate();
        }
        return {};
      }
      if (command instanceof DescribeTableCommand) {
        if (handlers.onDescribe) {
          return handlers.onDescribe();
        }
        return {
          Table: {
            TableStatus: 'ACTIVE',
          },
        };
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    },
  } as DynamoDBClient;
}

describe('parseCreateValidationTableEnv', () => {
  it('rejects empty DYNAMODB_TABLE_NAME', () => {
    assert.throws(
      () =>
        parseCreateValidationTableEnv({
          DYNAMODB_TABLE_NAME: '   ',
        }),
      /DYNAMODB_TABLE_NAME must be a non-empty string/,
    );
  });

  it('rejects empty AWS_REGION', () => {
    assert.throws(
      () =>
        parseCreateValidationTableEnv({
          AWS_REGION: '',
        }),
      /AWS_REGION must be a non-empty string/,
    );
  });

  it('applies defaults when variables are omitted', () => {
    const options = parseCreateValidationTableEnv({});
    assert.equal(options.tableName, 'sisum-sprint11-validation');
    assert.equal(options.region, 'us-east-1');
    assert.equal(options.endpoint, undefined);
  });
});

describe('createValidationTable', () => {
  it('creates the table when it does not exist', async () => {
    let createCalls = 0;

    const client = mockClient({
      onCreate: async () => {
        createCalls += 1;
        return {};
      },
    });

    await createValidationTable(client, baseOptions);
    assert.equal(createCalls, 1);
  });

  it('treats ResourceInUseException as idempotent success', async () => {
    let createCalls = 0;

    const client = mockClient({
      onCreate: async () => {
        createCalls += 1;
        throw resourceInUseError();
      },
    });

    await createValidationTable(client, baseOptions);
    assert.equal(createCalls, 1);
  });

  it('propagates unexpected create errors', async () => {
    const client = mockClient({
      onCreate: async () => {
        const error = new Error('Access denied');
        error.name = 'AccessDeniedException';
        throw error;
      },
    });

    await assert.rejects(
      () => createValidationTable(client, baseOptions),
      /Access denied/,
    );
  });

  it('validates required option fields', async () => {
    const client = mockClient({});

    await assert.rejects(
      () =>
        createValidationTable(client, {
          ...baseOptions,
          tableName: '  ',
        }),
      /DYNAMODB_TABLE_NAME must be a non-empty string/,
    );
  });
});
