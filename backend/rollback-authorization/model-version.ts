/**
 * Task 5 — Approval / Rollback Governance Boundary.
 *
 * Extends Sprint 3's action-policy actor gate (RBAC + privileged MFA) with
 * an independently governed rollback authorization boundary. A
 * ROLLBACK_CANDIDATE verification outcome (see
 * post-action-verification/types.ts) is advisory only: it identifies that a
 * rollback *may* be warranted. It is never itself an authorization to
 * perform one. Authorization requires a human actor, passing the same
 * RBAC/MFA actor gate as any other privileged execution action
 * (auth/privileged-mfa.ts PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK), scoped
 * to the same tenant/account as the execution being rolled back.
 */
export const ROLLBACK_AUTHORIZATION_POLICY_VERSION = 'rollback-authorization-v1';
