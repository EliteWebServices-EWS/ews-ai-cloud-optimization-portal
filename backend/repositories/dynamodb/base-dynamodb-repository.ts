import type {
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryConflictError,
  RepositoryNotFoundError,
  isConditionalCheckFailure,
} from '../../database';

export interface UpdateExpressionResult {
  updateExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
}

const PROTECTED_FIELDS = new Set([
  'pk',
  'sk',
  'tenantId',
  'workflowId',
  'reportId',
  'learningId',
  'verificationId',
  'resourceId',
  'resourceType',
  'version',
  'createdAt',
]);

export abstract class BaseDynamoDbRepository {
  protected constructor(
    protected readonly client: DynamoDBDocumentClient,
    protected readonly tableName: string,
  ) {
    if (!tableName.trim()) {
      throw new Error('DynamoDB table name must not be empty.');
    }
  }

  /**
   * Builds a safe DynamoDB update expression.
   *
   * Protected identity and version fields cannot be changed by callers.
   * Every successful update refreshes updatedAt and increments version.
   */
  protected buildVersionedUpdateExpression(
    changes: Record<string, unknown>,
    expectedVersion: number,
  ): UpdateExpressionResult {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error(
        'expectedVersion must be a positive integer.',
      );
    }

    const expressionAttributeNames: Record<string, string> = {
      '#version': 'version',
      '#updatedAt': 'updatedAt',
    };

    const expressionAttributeValues: Record<string, unknown> = {
      ':expectedVersion': expectedVersion,
      ':one': 1,
      ':updatedAt': new Date().toISOString(),
    };

    const assignments: string[] = [
      '#updatedAt = :updatedAt',
      '#version = #version + :one',
    ];

    let fieldIndex = 0;

    for (const [fieldName, fieldValue] of Object.entries(changes)) {
      if (fieldValue === undefined) {
        continue;
      }

      if (PROTECTED_FIELDS.has(fieldName)) {
        throw new Error(
          `${fieldName} cannot be updated through the repository.`,
        );
      }

      const namePlaceholder = `#field${fieldIndex}`;
      const valuePlaceholder = `:value${fieldIndex}`;

      expressionAttributeNames[namePlaceholder] = fieldName;
      expressionAttributeValues[valuePlaceholder] = fieldValue;

      assignments.push(
        `${namePlaceholder} = ${valuePlaceholder}`,
      );

      fieldIndex += 1;
    }

    return {
      updateExpression: `SET ${assignments.join(', ')}`,
      expressionAttributeNames,
      expressionAttributeValues,
    };
  }

  protected throwConditionalCreateError(
    error: unknown,
    message: string,
  ): never {
    if (isConditionalCheckFailure(error)) {
      throw new RepositoryConflictError(message);
    }

    throw error;
  }

  protected throwVersionConflict(
    error: unknown,
    message: string,
  ): never {
    if (isConditionalCheckFailure(error)) {
      throw new RepositoryConflictError(message);
    }

    throw error;
  }

  protected throwDeleteConflict(
    error: unknown,
    message: string,
  ): never {
    if (isConditionalCheckFailure(error)) {
      throw new RepositoryNotFoundError(message);
    }

    throw error;
  }
}