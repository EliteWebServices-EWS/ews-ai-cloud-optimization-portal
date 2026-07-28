/**
 * Trusted invocation mode for Express — separates Lambda adapter traffic from
 * direct HTTP (local dev / npm start). Defaults fail-closed to direct-http.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { stripUntrustedIdentityHeaders } from './internal-identity-headers';

export type IdentitySource = 'lambda-adapter' | 'direct-http';

export interface CreateAppIdentityOptions {
  identitySource?: IdentitySource;
}

/**
 * Resolve identity source. Missing or unknown values use direct-http (untrusted).
 */
export function resolveIdentitySource(
  options?: CreateAppIdentityOptions,
): IdentitySource {
  if (options?.identitySource === 'lambda-adapter') {
    return 'lambda-adapter';
  }

  return 'direct-http';
}

/**
 * direct-http: strip all internal identity headers before route handlers.
 * lambda-adapter: preserve headers set by backend/lambda.ts on the event.
 */
export function createIdentitySourceMiddleware(
  identitySource: IdentitySource,
): RequestHandler {
  if (identitySource === 'lambda-adapter') {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    stripUntrustedIdentityHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    );
    next();
  };
}
