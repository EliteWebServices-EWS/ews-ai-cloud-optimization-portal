/**
 * DynamoDB keys are plain objects returned as LastEvaluatedKey.
 */
export type DynamoDbKey = Record<string, unknown>;

/**
 * Raised when a client supplies a malformed pagination token.
 */
export class InvalidPaginationTokenError extends Error {
  constructor() {
    super('The supplied pagination token is invalid.');
    this.name = 'InvalidPaginationTokenError';
  }
}

/**
 * Converts a DynamoDB LastEvaluatedKey into an opaque URL-safe token.
 */
export function encodeNextToken(
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  if (!lastEvaluatedKey) {
    return undefined;
  }

  const serializedKey = JSON.stringify(lastEvaluatedKey);

  return Buffer.from(serializedKey, 'utf8').toString(
    'base64url',
  );
}

/**
 * Converts an opaque nextToken back into a DynamoDB ExclusiveStartKey.
 */
export function decodeNextToken(
  nextToken?: string,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }

  try {
    const serializedKey = Buffer.from(
      nextToken,
      'base64url',
    ).toString('utf8');

    const parsedValue: unknown = JSON.parse(serializedKey);

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      throw new InvalidPaginationTokenError();
    }

    return parsedValue as DynamoDbKey;
  } catch (error) {
    if (error instanceof InvalidPaginationTokenError) {
      throw error;
    }

    throw new InvalidPaginationTokenError();
  }
}