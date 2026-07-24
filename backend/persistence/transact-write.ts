import {
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  isConditionalCheckFailure,
  OwnershipConflictError,
  RepositoryConflictError,
} from '../database';

import type { PersistedItem } from './persistence-table';

export interface TransactPutOperation {
  tableName: string;
  item: PersistedItem;
  conditionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
}

function mapTransactionFailure(error: unknown): Error {
  if (!isConditionalCheckFailure(error)) {
    return error instanceof Error ? error : new Error('Transaction failed.');
  }

  const message =
    error instanceof Error ? error.message : 'Conditional check failed.';

  if (message.includes('ownerTenantId') || message.includes('tenantId')) {
    return new OwnershipConflictError();
  }

  return new RepositoryConflictError(
    'The transaction was cancelled because a conditional write failed.',
  );
}

export async function executeTransactWrite(
  client: DynamoDBDocumentClient,
  operations: TransactPutOperation[],
): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  if (operations.length > 100) {
    throw new Error('TransactWrite supports at most 100 items.');
  }

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: operations.map((operation) => ({
          Put: {
            TableName: operation.tableName,
            Item: operation.item,
            ...(operation.conditionExpression
              ? {
                  ConditionExpression: operation.conditionExpression,
                  ExpressionAttributeNames:
                    operation.expressionAttributeNames,
                  ExpressionAttributeValues:
                    operation.expressionAttributeValues,
                }
              : {}),
          },
        })),
      }),
    );
  } catch (error) {
    throw mapTransactionFailure(error);
  }
}
