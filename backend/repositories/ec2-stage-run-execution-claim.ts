import { RepositoryConflictError } from '../database';
import {
  computeLeaseExpiresAtIso,
  EC2_STAGE_EXECUTION_LEASE_SECONDS,
  isStageExecutionLeaseActive,
  type StageRunLike,
} from '../services/ec2-stage-run-execution-metadata';

export class Ec2StageRunActiveLeaseError extends RepositoryConflictError {
  constructor() {
    super('Stage execution lease is active.');
    this.name = 'Ec2StageRunActiveLeaseError';
  }
}

export class Ec2StageRunPermanentFailureError extends Error {
  constructor(message = 'Stage execution failed permanently.') {
    super(message);
    this.name = 'Ec2StageRunPermanentFailureError';
  }
}

export type StageRunClaimPlan =
  | { kind: 'create'; attemptCount: 1; executionOwnerId: string; leaseExpiresAt: string }
  | {
      kind: 'reclaim';
      expectedVersion: number;
      attemptCount: number;
      executionOwnerId: string;
      leaseExpiresAt: string;
    };

export function planStageRunExecutionClaim(
  run: StageRunLike | null,
  nowMs: number,
  executionOwnerIdForAttempt: (attemptCount: number) => string,
  leaseSeconds = EC2_STAGE_EXECUTION_LEASE_SECONDS,
): StageRunClaimPlan {
  if (!run) {
    const attemptCount = 1;
    return {
      kind: 'create',
      attemptCount,
      executionOwnerId: executionOwnerIdForAttempt(attemptCount),
      leaseExpiresAt: computeLeaseExpiresAtIso(nowMs, leaseSeconds),
    };
  }

  if (
    (run.status === 'SUCCEEDED' || run.status === 'PARTIAL') &&
    run.completedAt
  ) {
    throw new Error('Cannot claim a terminal completed stage run.');
  }

  if (run.status === 'RUNNING') {
    if (isStageExecutionLeaseActive(run.leaseExpiresAt, nowMs)) {
      throw new Ec2StageRunActiveLeaseError();
    }
    const attemptCount = (run.attemptCount ?? 1) + 1;
    return {
      kind: 'reclaim',
      expectedVersion: run.version,
      attemptCount,
      executionOwnerId: executionOwnerIdForAttempt(attemptCount),
      leaseExpiresAt: computeLeaseExpiresAtIso(nowMs, leaseSeconds),
    };
  }

  if (run.status === 'FAILED' && run.completedAt) {
    if (run.failureRetryable === false) {
      throw new Ec2StageRunPermanentFailureError();
    }
    const attemptCount = (run.attemptCount ?? 1) + 1;
    return {
      kind: 'reclaim',
      expectedVersion: run.version,
      attemptCount,
      executionOwnerId: executionOwnerIdForAttempt(attemptCount),
      leaseExpiresAt: computeLeaseExpiresAtIso(nowMs, leaseSeconds),
    };
  }

  throw new Error('Stage run state is not claimable.');
}

export function applyMockStageRunExecutionReclaim<T extends StageRunLike & { startedAt?: string }>(
  existing: T,
  plan: Extract<StageRunClaimPlan, { kind: 'reclaim' }>,
): T {
  if (existing.version !== plan.expectedVersion) {
    throw new RepositoryConflictError('Stage run version conflict.');
  }
  return {
    ...existing,
    status: 'RUNNING',
    completedAt: undefined,
    failureRetryable: undefined,
    executionOwnerId: plan.executionOwnerId,
    leaseExpiresAt: plan.leaseExpiresAt,
    attemptCount: plan.attemptCount,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };
}
