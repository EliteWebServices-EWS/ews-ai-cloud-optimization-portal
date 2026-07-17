/**
 * SISU'M application roles and authorization helpers.
 */

export const SISUM_ROLES = {
  VIEWER: 'viewer',
  ANALYST: 'analyst',
  ADMIN: 'admin',
} as const;

export type SisumRole =
  (typeof SISUM_ROLES)[keyof typeof SISUM_ROLES];

export const ALL_AUTHENTICATED_ROLES: readonly SisumRole[] = [
  SISUM_ROLES.VIEWER,
  SISUM_ROLES.ANALYST,
  SISUM_ROLES.ADMIN,
];

export const ANALYSIS_ROLES: readonly SisumRole[] = [
  SISUM_ROLES.ANALYST,
  SISUM_ROLES.ADMIN,
];

export const ADMIN_ROLES: readonly SisumRole[] = [
  SISUM_ROLES.ADMIN,
];

export function isSisumRole(value: string): value is SisumRole {
  return Object.values(SISUM_ROLES).includes(value as SisumRole);
}