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
 * Raised when a resource ownership record already belongs to another tenant.
 * Callers must map this to a safe miss (404) without exposing the owner tenant.
 */
export class OwnershipConflictError extends Error {
  constructor(
    message = 'The resource ownership record conflicts with an existing owner.',
  ) {
    super(message);
    this.name = 'OwnershipConflictError';
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