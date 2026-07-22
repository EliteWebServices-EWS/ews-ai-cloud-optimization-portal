/**
 * Raised when a conditional create operation finds an existing record.
 */
export class RepositoryAlreadyExistsError extends Error {
  constructor(message = 'The record already exists.') {
    super(message);
    this.name = 'RepositoryAlreadyExistsError';
  }
}

/**
 * Raised when an expected repository record does not exist.
 */
export class RepositoryNotFoundError extends Error {
  constructor(message = 'The requested record was not found.') {
    super(message);
    this.name = 'RepositoryNotFoundError';
  }
}

/**
 * Raised when optimistic locking detects a stale version.
 */
export class RepositoryConflictError extends Error {
  constructor(
    message = 'The record was modified by another request.',
  ) {
    super(message);
    this.name = 'RepositoryConflictError';
  }
}

/**
 * Identifies DynamoDB conditional-write failures without importing
 * service-specific exception classes throughout the repository layer.
 */
export function isConditionalCheckFailure(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.name === 'ConditionalCheckFailedException'
  );
}