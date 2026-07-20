/**
 * Production CORS allowlist for the SISU'M backend API.
 *
 * Origins are validated against an explicit list. Arbitrary Origin headers
 * are never reflected. Local development may opt in via CORS_ALLOW_LOCAL.
 */

import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

/** Production frontend origins required for the dashboard. */
export const PRODUCTION_CORS_ORIGINS:
  readonly string[] = [
    'https://elitewebservices.org',
    'https://www.elitewebservices.org',
  ];

/** CloudFront distribution retained as a documented fallback origin. */
export const CLOUDFRONT_FALLBACK_ORIGIN =
  'https://d287wcw6yqb2r1.cloudfront.net';

const LOCAL_DEV_ORIGIN = 'http://localhost:5173';

const CORS_METHODS = 'GET, POST, OPTIONS';

const CORS_REQUEST_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Request-Id',
  'X-Correlation-Id',
].join(', ');

const CORS_EXPOSE_HEADERS =
  'X-Request-Id, X-Correlation-Id';

function parseOriginList(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Resolve the active CORS allowlist from environment configuration.
 */
export function resolveAllowedOrigins(): readonly string[] {
  const explicitList =
    process.env.CORS_ALLOWED_ORIGINS?.trim();

  if (explicitList) {
    return parseOriginList(explicitList);
  }

  const singleOrigin = process.env.CORS_ORIGIN?.trim();

  if (singleOrigin && singleOrigin !== '*') {
    const origins = new Set<string>(PRODUCTION_CORS_ORIGINS);

    if (singleOrigin !== PRODUCTION_CORS_ORIGINS[0]) {
      origins.add(singleOrigin);
    }

    return [...origins];
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    (process.env.CORS_ALLOW_LOCAL === 'true' ||
      process.env.NODE_ENV === 'development')
  ) {
    return [
      ...PRODUCTION_CORS_ORIGINS,
      CLOUDFRONT_FALLBACK_ORIGIN,
      LOCAL_DEV_ORIGIN,
    ];
  }

  return [...PRODUCTION_CORS_ORIGINS];
}

/**
 * Returns true when wildcard CORS is explicitly enabled for non-production use.
 *
 * Wildcard mode is never active when NODE_ENV=production, even if
 * CORS_ORIGIN=* is set.
 */
export function isWildcardCorsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.CORS_ORIGIN?.trim() === '*'
  );
}

function resolveAccessControlAllowOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[]
): string | null {
  if (isWildcardCorsEnabled()) {
    return requestOrigin ?? '*';
  }

  if (!requestOrigin) {
    return null;
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

function applyCorsHeaders(
  res: Response,
  allowOrigin: string | null,
  varyOrigin: boolean
): void {
  if (allowOrigin) {
    res.header('Access-Control-Allow-Origin', allowOrigin);
  }

  if (varyOrigin) {
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Methods', CORS_METHODS);
  res.header(
    'Access-Control-Allow-Headers',
    CORS_REQUEST_HEADERS
  );
  res.header(
    'Access-Control-Expose-Headers',
    CORS_EXPOSE_HEADERS
  );
}

/**
 * Express middleware that enforces the CORS allowlist.
 */
export function createCorsMiddleware(
  allowedOrigins: readonly string[] = resolveAllowedOrigins()
): RequestHandler {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const requestOrigin = req.header('Origin');
    const allowOrigin = resolveAccessControlAllowOrigin(
      requestOrigin,
      allowedOrigins
    );
    const varyOrigin =
      !isWildcardCorsEnabled() &&
      allowOrigin !== null &&
      allowOrigin !== '*';

    applyCorsHeaders(res, allowOrigin, varyOrigin);

    if (req.method === 'OPTIONS') {
      if (
        isWildcardCorsEnabled() ||
        !requestOrigin ||
        allowOrigin !== null
      ) {
        res.sendStatus(204);
        return;
      }

      res.sendStatus(403);
      return;
    }

    next();
  };
}

/**
 * @deprecated Use resolveAllowedOrigins() and createCorsMiddleware().
 * Retained for backward-compatible tests during migration.
 */
export function resolveCorsOrigin(): string {
  if (isWildcardCorsEnabled()) {
    return '*';
  }

  const allowed = resolveAllowedOrigins();

  return allowed[0] ?? PRODUCTION_CORS_ORIGINS[0];
}
