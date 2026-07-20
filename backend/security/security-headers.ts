/**
 * API-focused security response headers for SISU'M backend responses.
 *
 * These headers apply to JSON API responses only. Frontend CSP is managed
 * separately on CloudFront/S3 and must not block Cognito redirect flows.
 */

import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security':
    'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Cache-Control':
    'no-store, no-cache, must-revalidate, private',
};

export function getSecurityHeaders(): Readonly<
  Record<string, string>
> {
  return SECURITY_HEADERS;
}

/**
 * Applies security headers to every API response.
 */
export function createSecurityHeadersMiddleware(): RequestHandler {
  return (
    _req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    for (const [name, value] of Object.entries(
      SECURITY_HEADERS
    )) {
      res.setHeader(name, value);
    }

    next();
  };
}
