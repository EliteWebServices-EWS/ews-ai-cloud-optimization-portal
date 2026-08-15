import type { Ec2DiscoveryRunRepository } from '../repositories/contracts/ec2-cloud-resource-repository';
import type { Ec2CostAnalysisRunRepository } from '../repositories/contracts/ec2-cost-repository';
import type { Ec2SecurityAnalysisRunRepository } from '../repositories/contracts/ec2-security-repository';
import {
  isStageExecutionLeaseActive,
  type Ec2StageRunExecutionFields,
} from './ec2-stage-run-execution-metadata';

export type StageCompletionState =
  | 'missing'
  | 'complete'
  | 'in_progress_active'
  | 'in_progress_stale'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'ambiguous';

export interface StageCompletionProof {
  state: StageCompletionState;
}

type RunProofInput = Ec2StageRunExecutionFields & {
  status: string;
  completedAt?: string | null;
};

function classifyRun(run: RunProofInput | null | undefined, nowMs: number): StageCompletionProof {
  if (!run) {
    return { state: 'missing' };
  }
  if (run.status === 'RUNNING') {
    if (isStageExecutionLeaseActive(run.leaseExpiresAt, nowMs)) {
      return { state: 'in_progress_active' };
    }
    return { state: 'in_progress_stale' };
  }
  if ((run.status === 'SUCCEEDED' || run.status === 'PARTIAL') && run.completedAt) {
    return { state: 'complete' };
  }
  if (run.status === 'FAILED' && run.completedAt) {
    if (run.failureRetryable === false) {
      return { state: 'failed_permanent' };
    }
    return { state: 'failed_retryable' };
  }
  return { state: 'ambiguous' };
}

export class Ec2AsyncJobStageCompletionService {
  constructor(
    private readonly discoveryRuns: Ec2DiscoveryRunRepository,
    private readonly costRuns: Ec2CostAnalysisRunRepository,
    private readonly securityRuns: Ec2SecurityAnalysisRunRepository,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async discoveryRunProof(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<StageCompletionProof> {
    return classifyRun(
      await this.discoveryRuns.getRun(tenantId, accountId, runId, { consistentRead: true }),
      this.nowMs(),
    );
  }

  async costRunProof(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<StageCompletionProof> {
    return classifyRun(
      await this.costRuns.getRun(tenantId, accountId, runId, { consistentRead: true }),
      this.nowMs(),
    );
  }

  async securityRunProof(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<StageCompletionProof> {
    return classifyRun(
      await this.securityRuns.getRun(tenantId, accountId, runId, { consistentRead: true }),
      this.nowMs(),
    );
  }
}

export function stageProofIsComplete(proof: StageCompletionProof): boolean {
  return proof.state === 'complete';
}

export function stageProofRequiresExecutionClaim(proof: StageCompletionProof): boolean {
  return (
    proof.state === 'missing' ||
    proof.state === 'in_progress_stale' ||
    proof.state === 'failed_retryable'
  );
}
