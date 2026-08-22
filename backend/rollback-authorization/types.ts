import type { PostActionVerificationOutcome } from '../post-action-verification/types';
import type { RollbackAuthorizationReasonCode } from './reason-codes';

export const ROLLBACK_REQUEST_SOURCES = [
  'HUMAN_ACTOR',
  'ML',
  'VERIFICATION_ENGINE',
] as const;
export type RollbackRequestSource = (typeof ROLLBACK_REQUEST_SOURCES)[number];

export const ROLLBACK_ELIGIBLE_EXECUTION_STATES = ['EXECUTED', 'COMPLETED'] as const;
export type RollbackEligibleExecutionState =
  (typeof ROLLBACK_ELIGIBLE_EXECUTION_STATES)[number];

export interface RollbackTenantScope {
  tenantId: string;
  accountId: string;
}

export interface RollbackRequestActor {
  source: RollbackRequestSource;
  actorId: string | null;
  /** Pre-evaluated by auth/execution-api-authorization.ts — this module never derives roles itself. */
  authorized: boolean;
  /** Pre-evaluated by auth/privileged-mfa.ts evaluatePrivilegedMfa(...).satisfied — never re-derived here. */
  mfaVerified: boolean;
}

export interface EvaluateRollbackAuthorizationInput {
  evaluatedAt: string;
  executionId: string;
  /** Tenant/account the execution being rolled back actually belongs to. */
  executionScope: RollbackTenantScope;
  /** Tenant/account the requesting actor is scoped to. */
  requestScope: RollbackTenantScope;
  executionState: string;
  alreadyRolledBack: boolean;
  verificationOutcome: PostActionVerificationOutcome | null;
  rollbackEvidenceSufficient: boolean | null;
  requestedBy: RollbackRequestActor;
}

export interface RollbackAuthorizationDecision {
  authorized: boolean;
  reasonCodes: RollbackAuthorizationReasonCode[];
  policyVersion: string;
  evaluatedAt: string;
  executionId: string;
  /** Populated only when authorized === true — attribution is mandatory for an authorized rollback. */
  authorizedByActorId: string | null;
  authorizedAt: string | null;
}
