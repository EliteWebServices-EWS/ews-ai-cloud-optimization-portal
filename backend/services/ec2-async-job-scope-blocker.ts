import type { Ec2AsyncJobRecord } from '../async-jobs/ec2-async-job-models';
import {
  Ec2AsyncJobStageCompletionService,
  type StageCompletionProof,
} from './ec2-async-job-stage-completion';
import {
  ec2AsyncJobCostRunId,
  ec2AsyncJobDiscoveryRunId,
  ec2AsyncJobSecurityRunId,
} from './ec2-async-job-stage-runs';
import { EC2_STAGE_EXECUTION_LEASE_SECONDS } from './ec2-stage-run-execution-metadata';
import type { Ec2AsyncJobStage } from '../async-jobs/ec2-async-job-models';
import { isEc2AsyncJobActive } from './ec2-async-job-active';

/** Stages backed by discovery/cost/security run records with leaseExpiresAt fencing. */
export function ec2AsyncJobStageHasAuthoritativeLeaseProof(stage: Ec2AsyncJobStage): boolean {
  return stage === 'DISCOVERY' || stage === 'COST_ANALYSIS' || stage === 'SECURITY_ANALYSIS';
}

/**
 * Whether this durable job should block POST /analysis/ec2/start for the same scope.
 * Uses stage-run execution leases where they exist; otherwise preserves status-based blocking.
 */
export async function isEc2AsyncJobBlockingSameScopeStart(
  job: Ec2AsyncJobRecord,
  stageCompletion: Ec2AsyncJobStageCompletionService,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!isEc2AsyncJobActive(job)) {
    return false;
  }

  if (job.status === 'QUEUED') {
    return true;
  }

  const proof = await loadStageProof(job, stageCompletion);
  return classifyScopeBlockFromProof(job, proof, nowMs);
}

export function classifyScopeBlockFromProof(
  job: Ec2AsyncJobRecord,
  proof: StageCompletionProof,
  nowMs: number,
): boolean {
  const hasLeaseProof = ec2AsyncJobStageHasAuthoritativeLeaseProof(job.stage);

  switch (proof.state) {
    case 'in_progress_active':
      return true;
    case 'in_progress_stale':
    case 'failed_retryable':
    case 'failed_permanent':
    case 'complete':
      return false;
    case 'missing':
    case 'ambiguous':
      if (!hasLeaseProof) {
        return true;
      }
      return isJobMetadataWithinExecutionLeaseWindow(job, nowMs);
    default:
      if (!hasLeaseProof) {
        return true;
      }
      return isJobMetadataWithinExecutionLeaseWindow(job, nowMs);
  }
}

async function loadStageProof(
  job: Ec2AsyncJobRecord,
  stageCompletion: Ec2AsyncJobStageCompletionService,
): Promise<StageCompletionProof> {
  switch (job.stage) {
    case 'DISCOVERY':
      return stageCompletion.discoveryRunProof(
        job.tenantId,
        job.accountId,
        ec2AsyncJobDiscoveryRunId(job.jobId),
      );
    case 'COST_ANALYSIS':
      return stageCompletion.costRunProof(
        job.tenantId,
        job.accountId,
        ec2AsyncJobCostRunId(job.jobId),
      );
    case 'SECURITY_ANALYSIS':
      return stageCompletion.securityRunProof(
        job.tenantId,
        job.accountId,
        ec2AsyncJobSecurityRunId(job.jobId),
      );
    default:
      return { state: 'ambiguous' };
  }
}

/**
 * Grace window when a lease-backed stage has no run row yet (consumer race).
 * Not used for GOVERNANCE_ANALYSIS, FINALIZING, ENQUEUE, or COMPLETE.
 */
function isJobMetadataWithinExecutionLeaseWindow(
  job: Ec2AsyncJobRecord,
  nowMs: number,
): boolean {
  const anchor = job.updatedAt ?? job.startedAt ?? job.createdAt;
  const parsed = Date.parse(anchor);
  if (Number.isNaN(parsed)) {
    return false;
  }
  const ageMs = nowMs - parsed;
  return ageMs >= 0 && ageMs < EC2_STAGE_EXECUTION_LEASE_SECONDS * 1000;
}
