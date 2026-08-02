/**
 * Rate limiting middleware for authenticated API routes.
 *
 * Two things make request-count limiting non-trivial in this deployment:
 *
 * 1. This runs behind API Gateway/Lambda (see backend/template.yaml),
 *    where every request can arrive from a different warm/cold container
 *    and the client-visible IP is frequently a shared NAT/proxy address —
 *    IP-keyed limiting is unreliable here. Every route that reaches this
 *    middleware has already been authenticated (requireAnyRole /
 *    requireTenantContext run upstream), so we key on the authenticated
 *    tenantId + userId instead, which is both stable and meaningful
 *    (limits apply per caller, not per shared egress IP).
 *
 * 2. express-rate-limit's default store is in-process memory, so limits
 *    are enforced per Lambda execution environment, not globally across
 *    every concurrent invocation. That's a real gap for a horizontally
 *    scaled Lambda deployment. It still provides meaningful protection
 *    against a single hot/warm container being hammered (the common
 *    case — API Gateway reuses warm containers under sustained load) and
 *    is required by our CodeQL policy (routes that authorize must rate
 *    limit). API Gateway's own throttle (see DefaultRouteSettings in
 *    template.yaml) provides the account-wide backstop. For strict,
 *    globally-consistent per-tenant limits, swap the `store` option for
 *    a DynamoDB- or ElastiCache-backed rate-limit store — the interface
 *    below is written so that's a one-line change, not a rewrite.
 */

import rateLimit, { type Options as RateLimitOptions, ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

import { getAuditActor } from '../audit';

/** Keys by authenticated tenantId+userId; falls back to IP pre-authentication. */
function identityKeyGenerator(req: Request): string {
  const actor = getAuditActor(req);
  if (actor.authenticated && actor.userId) {
    const tenantId =
      (req as unknown as { tenantContext?: { tenantId?: string } }).tenantContext?.tenantId ??
      'no-tenant';
    return `${tenantId}:${actor.userId}`;
  }
  return ipKeyGenerator(req.ip ?? 'unknown');
}

export type RateLimitPreset = Partial<RateLimitOptions>;

const BASE_OPTIONS: RateLimitPreset = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: identityKeyGenerator,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again shortly.',
    },
  },
};

/**
 * Default limiter for authenticated read/write routes: generous enough
 * for normal interactive use, tight enough to blunt scripted abuse.
 */
export function createStandardRateLimit(preset: RateLimitPreset = {}) {
  return rateLimit({
    windowMs: 60_000,
    limit: 60,
    ...BASE_OPTIONS,
    ...preset,
  });
}

/**
 * Stricter limiter for sensitive, expensive, or privileged mutations
 * (e.g. registering/removing a live AWS account connection, or anything
 * that triggers an outbound AssumeRole call) where abuse is higher-impact
 * and legitimate callers rarely need a high request rate.
 */
export function createSensitiveRateLimit(preset: RateLimitPreset = {}) {
  return rateLimit({
    windowMs: 60_000,
    limit: 10,
    ...BASE_OPTIONS,
    ...preset,
  });
}
