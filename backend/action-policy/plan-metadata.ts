import type { ActionPolicyResult } from './types';

export const EXECUTION_PLAN_METADATA_ACCOUNT_ID = 'accountId';
export const EXECUTION_PLAN_METADATA_CORRELATION_ID = 'correlationId';
export const EXECUTION_PLAN_METADATA_DECISION_ID = 'decisionId';
export const EXECUTION_PLAN_METADATA_FINDING_KEY = 'findingKey';
export const EXECUTION_PLAN_METADATA_RESOURCE_ID = 'resourceId';
export const EXECUTION_PLAN_METADATA_ACTION_POLICY_VERSION = 'actionPolicyVersion';
export const EXECUTION_PLAN_METADATA_ACTION_POLICY_SNAPSHOT = 'actionPolicySnapshot';
export const EXECUTION_PLAN_METADATA_ACTION_MODE = 'actionMode';
export const EXECUTION_PLAN_METADATA_APPROVAL_ACTOR_ROLE = 'approvalActorRole';
export const EXECUTION_PLAN_METADATA_APPROVAL_REASON = 'approvalReason';

export interface ExecutionPlanPolicyProvenance {
  accountId: string;
  correlationId: string;
  decisionId?: string;
  findingKey?: string;
  resourceId?: string;
  actionPolicyVersion: string;
  actionPolicySnapshot: ActionPolicyResult;
  actionMode: ActionPolicyResult['actionMode'];
}

export function buildPolicyMetadata(
  provenance: ExecutionPlanPolicyProvenance,
): Record<string, unknown> {
  return {
    [EXECUTION_PLAN_METADATA_ACCOUNT_ID]: provenance.accountId,
    [EXECUTION_PLAN_METADATA_CORRELATION_ID]: provenance.correlationId,
    ...(provenance.decisionId
      ? { [EXECUTION_PLAN_METADATA_DECISION_ID]: provenance.decisionId }
      : {}),
    ...(provenance.findingKey
      ? { [EXECUTION_PLAN_METADATA_FINDING_KEY]: provenance.findingKey }
      : {}),
    ...(provenance.resourceId
      ? { [EXECUTION_PLAN_METADATA_RESOURCE_ID]: provenance.resourceId }
      : {}),
    [EXECUTION_PLAN_METADATA_ACTION_POLICY_VERSION]: provenance.actionPolicyVersion,
    [EXECUTION_PLAN_METADATA_ACTION_POLICY_SNAPSHOT]: provenance.actionPolicySnapshot,
    [EXECUTION_PLAN_METADATA_ACTION_MODE]: provenance.actionMode,
  };
}

export function readPolicySnapshot(
  metadata: Record<string, unknown> | undefined,
): ActionPolicyResult | undefined {
  const snapshot = metadata?.[EXECUTION_PLAN_METADATA_ACTION_POLICY_SNAPSHOT];
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined;
  }
  return snapshot as ActionPolicyResult;
}

export function readPolicyProvenance(
  metadata: Record<string, unknown> | undefined,
): Partial<ExecutionPlanPolicyProvenance> | undefined {
  if (!metadata) {
    return undefined;
  }

  const accountId = metadata[EXECUTION_PLAN_METADATA_ACCOUNT_ID];
  const correlationId = metadata[EXECUTION_PLAN_METADATA_CORRELATION_ID];
  const snapshot = readPolicySnapshot(metadata);

  if (typeof accountId !== 'string' || typeof correlationId !== 'string' || !snapshot) {
    return undefined;
  }

  return {
    accountId,
    correlationId,
    decisionId:
      typeof metadata[EXECUTION_PLAN_METADATA_DECISION_ID] === 'string'
        ? String(metadata[EXECUTION_PLAN_METADATA_DECISION_ID])
        : undefined,
    findingKey:
      typeof metadata[EXECUTION_PLAN_METADATA_FINDING_KEY] === 'string'
        ? String(metadata[EXECUTION_PLAN_METADATA_FINDING_KEY])
        : undefined,
    resourceId:
      typeof metadata[EXECUTION_PLAN_METADATA_RESOURCE_ID] === 'string'
        ? String(metadata[EXECUTION_PLAN_METADATA_RESOURCE_ID])
        : undefined,
    actionPolicyVersion:
      typeof metadata[EXECUTION_PLAN_METADATA_ACTION_POLICY_VERSION] === 'string'
        ? String(metadata[EXECUTION_PLAN_METADATA_ACTION_POLICY_VERSION])
        : snapshot.policyVersion,
    actionPolicySnapshot: snapshot,
    actionMode: snapshot.actionMode,
  };
}
