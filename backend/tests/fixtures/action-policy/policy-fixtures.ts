import type { ActionPolicyContextBody } from '../../../api/execution-api-validation';
import type { ActionPolicyReadinessInput } from '../../../action-policy/types';
import { DECISION_READINESS_POLICY_VERSION } from '../../../decision-readiness/model-version';
import { DECISION_READINESS_REASON } from '../../../decision-readiness/reason-codes';
import { ACCOUNT_A, TENANT_A } from '../evidence/identities';

export const FIXED_POLICY_EVALUATED_AT = '2026-08-19T12:00:00.000Z';

export function buildReadyReadinessInput(
  overrides: Partial<ActionPolicyReadinessInput> = {},
): ActionPolicyReadinessInput {
  return {
    readiness: 'READY',
    reasonCodes: [DECISION_READINESS_REASON.READY],
    policyVersion: DECISION_READINESS_POLICY_VERSION,
    recommendedAction: 'RESIZE_INSTANCE',
    ...overrides,
  };
}

export function buildNotReadyReadinessInput(
  overrides: Partial<ActionPolicyReadinessInput> = {},
): ActionPolicyReadinessInput {
  return {
    readiness: 'NOT_READY',
    reasonCodes: [DECISION_READINESS_REASON.PERSISTENCE_NOT_STABLE],
    policyVersion: DECISION_READINESS_POLICY_VERSION,
    recommendedAction: 'RESIZE_INSTANCE',
    ...overrides,
  };
}

export function buildProductionPolicyContext(
  overrides: Partial<ActionPolicyContextBody> = {},
): ActionPolicyContextBody {
  return {
    accountId: ACCOUNT_A,
    actionMode: 'PRODUCTION',
    infrastructureChanging: true,
    decisionReadiness: buildReadyReadinessInput(),
    findingKey: 'finding-key-a',
    resourceId: 'i-abc',
    ...overrides,
  };
}

export function buildSimulationPolicyContext(
  overrides: Partial<ActionPolicyContextBody> = {},
): ActionPolicyContextBody {
  return buildProductionPolicyContext({
    actionMode: 'SIMULATION',
    infrastructureChanging: true,
    ...overrides,
  });
}

/** Policy context for execution API integration tests (tenant-exec-a flows). */
export function buildExecutionApiPolicyContext(
  overrides: Partial<ActionPolicyContextBody> = {},
): ActionPolicyContextBody {
  return buildProductionPolicyContext({
    accountId: '111122223333',
    findingKey: 'finding-exec-api',
    resourceId: 'i-exec-api',
    ...overrides,
  });
}

export const POLICY_TEST_TENANT = TENANT_A;
