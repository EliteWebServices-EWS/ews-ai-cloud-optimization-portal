import type { Ec2DiscoveryRunRepository } from '../repositories/contracts/ec2-cloud-resource-repository';
import type { Ec2CostAnalysisRunRepository } from '../repositories/contracts/ec2-cost-repository';
import type { Ec2SecurityAnalysisRunRepository } from '../repositories/contracts/ec2-security-repository';
import { EC2_COST_DEFAULT_PERIOD_SECONDS } from '../cloud-intelligence/ec2-cost/ec2-cost-limits';
import { buildStageExecutionOwnerId } from './ec2-stage-run-execution-metadata';

export interface ClaimedStageRunExecution {
  runId: string;
  resumeRunExpectedVersion: number;
  attemptCount: number;
}

export class Ec2AsyncJobStageExecutionService {
  constructor(
    private readonly discoveryRuns: Ec2DiscoveryRunRepository,
    private readonly costRuns: Ec2CostAnalysisRunRepository,
    private readonly securityRuns: Ec2SecurityAnalysisRunRepository,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async claimDiscoveryExecution(input: {
    jobId: string;
    tenantId: string;
    accountId: string;
    regions: string[];
  }): Promise<ClaimedStageRunExecution> {
    const runId = `${input.jobId}#discovery`;
    const startedAt = new Date(this.nowMs()).toISOString();
    const ownerForAttempt = (attemptCount: number) =>
      buildStageExecutionOwnerId(input.jobId, 'discovery', attemptCount);
    const run = await this.discoveryRuns.claimExecution({
      runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      requestedRegions: input.regions,
      startedAt,
      nowMs: this.nowMs(),
      executionOwnerIdForAttempt: ownerForAttempt,
    });
    return {
      runId,
      resumeRunExpectedVersion: run.version,
      attemptCount: run.attemptCount ?? 1,
    };
  }

  async claimCostExecution(input: {
    jobId: string;
    tenantId: string;
    accountId: string;
    regions: string[];
    observationDays?: number;
  }): Promise<ClaimedStageRunExecution> {
    const runId = `${input.jobId}#cost`;
    const startedAt = new Date(this.nowMs()).toISOString();
    const ownerForAttempt = (attemptCount: number) =>
      buildStageExecutionOwnerId(input.jobId, 'cost', attemptCount);
    const run = await this.costRuns.claimExecution({
      runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      regions: input.regions,
      observationDays: input.observationDays ?? 14,
      periodSeconds: EC2_COST_DEFAULT_PERIOD_SECONDS,
      requestedAt: startedAt,
      startedAt,
      nowMs: this.nowMs(),
      executionOwnerIdForAttempt: ownerForAttempt,
    });
    return {
      runId,
      resumeRunExpectedVersion: run.version,
      attemptCount: run.attemptCount ?? 1,
    };
  }

  async claimSecurityExecution(input: {
    jobId: string;
    tenantId: string;
    accountId: string;
    regions: string[];
  }): Promise<ClaimedStageRunExecution> {
    const runId = `${input.jobId}#security`;
    const startedAt = new Date(this.nowMs()).toISOString();
    const ownerForAttempt = (attemptCount: number) =>
      buildStageExecutionOwnerId(input.jobId, 'security', attemptCount);
    const run = await this.securityRuns.claimExecution({
      runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      regions: input.regions,
      startedAt,
      nowMs: this.nowMs(),
      executionOwnerIdForAttempt: ownerForAttempt,
    });
    return {
      runId,
      resumeRunExpectedVersion: run.version,
      attemptCount: run.attemptCount ?? 1,
    };
  }
}
