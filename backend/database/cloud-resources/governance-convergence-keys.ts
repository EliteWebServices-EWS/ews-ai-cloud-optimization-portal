import { requireKeyValue, requireOpaqueKeyValue } from '../dynamodb-keys';

/**
 * Mirrors evidence-observation-keys.ts (Engineer 1's Sprint 1 pattern).
 * Uses the same shared cloud-resources table and account partition key —
 * no new table or GSI.
 */
export const GOVERNANCE_CONVERGENCE_OBSERVATION_ENTITY = 'GOVERNANCE_CONVERGENCE_OBSERVATION' as const;
export const GOVERNANCE_CONVERGENCE_OBSERVATION_SK_PREFIX = `${GOVERNANCE_CONVERGENCE_OBSERVATION_ENTITY}#`;

export function governanceConvergenceObservationSortKey(input: {
  findingKey: string;
  observationTimestampIso: string;
  logicalObservationId: string;
}): string {
  return `${GOVERNANCE_CONVERGENCE_OBSERVATION_SK_PREFIX}FK#${requireOpaqueKeyValue(
    input.findingKey,
    'findingKey',
  )}#TS#${requireKeyValue(
    input.observationTimestampIso,
    'observationTimestampIso',
  )}#LOG#${requireOpaqueKeyValue(input.logicalObservationId, 'logicalObservationId')}`;
}

export function governanceConvergenceObservationSortKeyPrefixForFinding(findingKey: string): string {
  return `${GOVERNANCE_CONVERGENCE_OBSERVATION_SK_PREFIX}FK#${requireOpaqueKeyValue(findingKey, 'findingKey')}#`;
}

export const GOVERNANCE_CONVERGENCE_RESULT_ENTITY = 'GOVERNANCE_CONVERGENCE_RESULT' as const;
export const GOVERNANCE_CONVERGENCE_RESULT_SK_PREFIX = `${GOVERNANCE_CONVERGENCE_RESULT_ENTITY}#`;

/** Append-only result log, sorted so the newest result per finding queries first (ScanIndexForward: false). */
export function governanceConvergenceResultSortKey(input: {
  findingKey: string;
  evaluatedAtIso: string;
  resultId: string;
}): string {
  return `${GOVERNANCE_CONVERGENCE_RESULT_SK_PREFIX}FK#${requireOpaqueKeyValue(
    input.findingKey,
    'findingKey',
  )}#TS#${requireKeyValue(input.evaluatedAtIso, 'evaluatedAtIso')}#ID#${requireOpaqueKeyValue(
    input.resultId,
    'resultId',
  )}`;
}

export function governanceConvergenceResultSortKeyPrefixForFinding(findingKey: string): string {
  return `${GOVERNANCE_CONVERGENCE_RESULT_SK_PREFIX}FK#${requireOpaqueKeyValue(findingKey, 'findingKey')}#`;
}

/**
 * Deterministic finding-scope key for one tenant/account/resource/check —
 * reuses the same findingKey shape convention as buildEc2SecurityFindingKey
 * so this observation stream can be correlated with the underlying
 * Ec2SecurityFindingRecord by inspection.
 */
export function buildGovernanceConvergenceFindingKey(input: {
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  check: string;
}): string {
  return `${requireKeyValue(input.tenantId, 'tenantId')}#${requireKeyValue(
    input.accountId,
    'accountId',
  )}#${requireKeyValue(input.region, 'region')}#${requireKeyValue(
    input.resourceId,
    'resourceId',
  )}#${requireKeyValue(input.check, 'check')}`;
}

/**
 * The finding key embeds tenantId as its first `#`-delimited segment, so
 * ownership resolution (used only for safe-404 tenant.access_denied
 * auditing) is pure parsing — no separate ownership-index item or read is
 * needed. `requireKeyValue` already forbids `#` inside any individual
 * segment value, so this split is unambiguous.
 */
export function parseGovernanceConvergenceFindingKeyOwner(findingKey: string): string | undefined {
  const [tenantId] = findingKey.split('#');
  return tenantId && tenantId.length > 0 ? tenantId : undefined;
}
