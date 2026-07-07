import type { EngineError } from '../types';

/**
 * Application error with structured metadata for API and engine boundaries.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly stage?: string
  ) {
    super(message);
    this.name = 'AppError';
  }

  toEngineError(engine: string): EngineError {
    return {
      engine,
      code: this.code,
      reason: this.message,
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
