/**
 * Express request size limits and JSON parsing error handling.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { buildErrorResponse } from '../shared/utils';
import { getRequestId } from '../audit';

/** Default JSON body size limit for API requests. */
export const DEFAULT_JSON_BODY_LIMIT = '256kb';

export function createJsonBodyParser(
  limit: string = DEFAULT_JSON_BODY_LIMIT
): express.RequestHandler {
  return express.json({ limit });
}

function isSyntaxError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError;
}

function isEntityTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  );
}

/**
 * Converts JSON parser failures into structured API error responses.
 */
export function createJsonErrorHandler(): express.ErrorRequestHandler {
  return (
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = getRequestId(req);

    if (isEntityTooLarge(error)) {
      res.status(413).json(
        buildErrorResponse(
          'PAYLOAD_TOO_LARGE',
          'Request body exceeds the allowed size limit.',
          requestId,
          'request'
        )
      );
      return;
    }

    if (isSyntaxError(error) && 'body' in error) {
      res.status(400).json(
        buildErrorResponse(
          'INVALID_JSON',
          'Malformed JSON request body.',
          requestId,
          'request'
        )
      );
      return;
    }

    next(error);
  };
}
