/** Durable execution lease — must exceed single-stage Lambda work (300s) with margin. */
export const EC2_STAGE_EXECUTION_LEASE_SECONDS = 360;

export interface Ec2StageRunExecutionFields {
  executionOwnerId?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
  failureRetryable?: boolean;
}

export function buildStageExecutionOwnerId(
  jobId: string,
  stageToken: 'discovery' | 'cost' | 'security',
  attemptCount: number,
): string {
  return `async:${jobId}:${stageToken}:attempt:${attemptCount}`;
}

export function computeLeaseExpiresAtIso(nowMs: number, leaseSeconds = EC2_STAGE_EXECUTION_LEASE_SECONDS): string {
  return new Date(nowMs + leaseSeconds * 1000).toISOString();
}

export function isStageExecutionLeaseActive(
  leaseExpiresAt: string | undefined,
  nowMs: number,
): boolean {
  if (!leaseExpiresAt) {
    return false;
  }
  return Date.parse(leaseExpiresAt) > nowMs;
}

export interface StageRunLike extends Ec2StageRunExecutionFields {
  status: string;
  completedAt?: string | null;
  version: number;
}
