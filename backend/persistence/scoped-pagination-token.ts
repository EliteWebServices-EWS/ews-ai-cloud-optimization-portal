import {
  decodeNextToken,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';

interface ScopedPaginationPayload {
  v: 1;
  tenantId: string;
  scope: string;
  key: DynamoDbKey;
}

export interface ScopedPaginationContext {
  tenantId: string;
  scope: string;
}

export function encodeScopedNextToken(
  context: ScopedPaginationContext,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  if (!lastEvaluatedKey) {
    return undefined;
  }

  const payload: ScopedPaginationPayload = {
    v: 1,
    tenantId: context.tenantId,
    scope: context.scope,
    key: lastEvaluatedKey,
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeScopedNextToken(
  nextToken: string | undefined,
  expected: ScopedPaginationContext,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }

  try {
    const serialized = Buffer.from(nextToken, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(serialized);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new InvalidPaginationTokenError();
    }

    const payload = parsed as Partial<ScopedPaginationPayload>;

    if (
      payload.v !== 1 ||
      payload.tenantId !== expected.tenantId ||
      payload.scope !== expected.scope ||
      !payload.key ||
      typeof payload.key !== 'object' ||
      Array.isArray(payload.key)
    ) {
      throw new InvalidPaginationTokenError();
    }

    return payload.key;
  } catch (error) {
    if (error instanceof InvalidPaginationTokenError) {
      throw error;
    }

    // Backward compatibility: accept opaque DynamoDB tokens from older clients.
    return decodeNextToken(nextToken);
  }
}
