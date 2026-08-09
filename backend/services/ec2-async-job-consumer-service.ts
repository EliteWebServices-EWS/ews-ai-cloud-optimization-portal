import { RepositoryConflictError } from '../database';
import type { AwsAccountRepository } from '../repositories/contracts';
import type { Ec2AsyncJobRepository } from '../repositories/contracts/ec2-async-job-repository';
import type { Ec2AsyncJobRecord } from '../async-jobs/ec2-async-job-models';
import type { Ec2IntelligenceQueueMessage } from '../async-jobs/ec2-intelligence-queue-message';
import { AUDIT_EVENTS } from '../audit/audit-events';
import { writeAuditEvent } from '../audit';
import { createLogger } from '../shared/utils';
import type { Ec2DiscoveryApiService } from './ec2-discovery-api-service';
import type { Ec2CostAnalysisApiService } from './ec2-cost-analysis-api-service';
import type { Ec2SecurityAnalysisApiService } from './ec2-security-analysis-api-service';
import {
  Ec2AsyncJobStageCompletionService,
  stageProofIsComplete,
  stageProofRequiresExecutionClaim,
  type StageCompletionProof,
} from './ec2-async-job-stage-completion';
import { Ec2AsyncJobStageExecutionService } from './ec2-async-job-stage-execution';
import { Ec2StageRunActiveLeaseError } from '../repositories/ec2-stage-run-execution-claim';
import {
  ec2AsyncJobCostRunId,
  ec2AsyncJobDiscoveryRunId,
  ec2AsyncJobSecurityRunId,
} from './ec2-async-job-stage-runs';
import {
  Ec2AsyncJobConsumerRetryableError,
  Ec2AsyncJobConsumerTerminalError,
  isRetryableConsumerError,
  sanitizeConsumerErrorSummary,
} from './ec2-async-job-consumer-errors';
import {
  regionsEqual,
} from './ec2-async-job-stage-order';
import {
  createEc2AsyncJobWorkerCallContext,
  type Ec2AsyncJobWorkerCallContext,
} from './ec2-async-job-worker-context';

const logger = createLogger('Ec2AsyncJobConsumer');

export const EC2_ASYNC_JOB_EVENT = {
  STARTED: 'ec2.async_job_started',
  STAGE_CHANGED: 'ec2.async_job_stage_changed',
  DUPLICATE_SKIPPED: 'ec2.async_job_duplicate_skipped',
  RETRYING: 'ec2.async_job_retrying',
  PARTIAL: 'ec2.async_job_partial',
  SUCCEEDED: 'ec2.async_job_succeeded',
  FAILED: 'ec2.async_job_failed',
  INVALID_MESSAGE_REJECTED: 'ec2.async_job_invalid_message_rejected',
  STAGE_RECOVERED: 'ec2.async_job_stage_recovered',
} as const;

export interface Ec2AsyncJobConsumerServiceDeps {
  jobs: Ec2AsyncJobRepository;
  awsAccounts: AwsAccountRepository;
  discovery: Ec2DiscoveryApiService;
  cost: Ec2CostAnalysisApiService;
  security: Ec2SecurityAnalysisApiService;
  stageCompletion: Ec2AsyncJobStageCompletionService;
  stageExecution: Ec2AsyncJobStageExecutionService;
}

export class Ec2AsyncJobConsumerService {
  constructor(private readonly deps: Ec2AsyncJobConsumerServiceDeps) {}

  async validateScopeAgainstDurableJob(
    message: Ec2IntelligenceQueueMessage,
    job: Ec2AsyncJobRecord,
  ): Promise<void> {
    if (message.tenantId !== job.tenantId) {
      throw new Ec2AsyncJobConsumerTerminalError('Tenant scope mismatch.');
    }
    if (message.jobId !== job.jobId) {
      throw new Ec2AsyncJobConsumerTerminalError('Job scope mismatch.');
    }
    if (message.accountId !== job.accountId) {
      throw new Ec2AsyncJobConsumerTerminalError('Account scope mismatch.');
    }
    if (message.jobType !== job.jobType) {
      throw new Ec2AsyncJobConsumerTerminalError('Job type mismatch.');
    }
    if (!regionsEqual(message.regions, job.regions)) {
      throw new Ec2AsyncJobConsumerTerminalError('Region scope mismatch.');
    }
  }

  async requireVerifiedAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.deps.awsAccounts.getById(tenantId, accountId);
    if (!account) {
      throw new Ec2AsyncJobConsumerTerminalError('AWS account connection not found.');
    }
    if (account.status !== 'VERIFIED') {
      throw new Ec2AsyncJobConsumerTerminalError('AWS account must be VERIFIED.');
    }
  }

  async claimOrReconcileJob(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    if (job.status === 'SUCCEEDED' && job.stage === 'COMPLETE') {
      return job;
    }

    if (job.status === 'FAILED') {
      return job;
    }

    if (job.status === 'QUEUED') {
      const now = new Date().toISOString();
      try {
        const claimed = await this.deps.jobs.updateJob(
          job.tenantId,
          job.jobId,
          {
            status: 'RUNNING',
            stage: 'DISCOVERY',
            startedAt: job.startedAt ?? now,
          },
          { expectedVersion: job.version },
        );
        await this.deps.jobs.appendEvent({
          tenantId: job.tenantId,
          jobId: job.jobId,
          eventType: EC2_ASYNC_JOB_EVENT.STARTED,
          correlationId: context.correlationId,
          status: claimed.status,
          stage: claimed.stage,
        });
        writeAuditEvent({
          eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_STARTED,
          outcome: 'started',
          actor: context.actor,
          tenantId: job.tenantId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          resource: { type: 'ec2_async_job', id: job.jobId, accountId: job.accountId },
        });
        return claimed;
      } catch (error) {
        if (error instanceof RepositoryConflictError) {
          const reloaded = await this.deps.jobs.getJob(job.tenantId, job.jobId);
          if (!reloaded) {
            throw new Ec2AsyncJobConsumerRetryableError('Job disappeared during claim.');
          }
          return reloaded;
        }
        throw error;
      }
    }

    return job;
  }

  private async advanceStage(
    job: Ec2AsyncJobRecord,
    stage: Ec2AsyncJobRecord['stage'],
    context: Ec2AsyncJobWorkerCallContext,
    extra?: { status?: Ec2AsyncJobRecord['status']; errorSummary?: string; completedAt?: string },
  ): Promise<Ec2AsyncJobRecord> {
    const updated = await this.deps.jobs.updateJob(
      job.tenantId,
      job.jobId,
      {
        stage,
        status: extra?.status ?? job.status,
        errorSummary: extra?.errorSummary,
        completedAt: extra?.completedAt,
      },
      { expectedVersion: job.version },
    );
    await this.deps.jobs.appendEvent({
      tenantId: job.tenantId,
      jobId: job.jobId,
      eventType: EC2_ASYNC_JOB_EVENT.STAGE_CHANGED,
      correlationId: context.correlationId,
      status: updated.status,
      stage: updated.stage,
      errorSummary: extra?.errorSummary,
    });
    return updated;
  }

  private async markRetrying(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
    safeSummary: string,
  ): Promise<void> {
    try {
      const updated = await this.deps.jobs.updateJob(
        job.tenantId,
        job.jobId,
        {
          retryCount: job.retryCount + 1,
          errorSummary: safeSummary,
        },
        { expectedVersion: job.version },
      );
      await this.deps.jobs.appendEvent({
        tenantId: job.tenantId,
        jobId: job.jobId,
        eventType: EC2_ASYNC_JOB_EVENT.RETRYING,
        correlationId: context.correlationId,
        status: updated.status,
        stage: updated.stage,
        errorSummary: safeSummary,
      });
      writeAuditEvent({
        eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_RETRYING,
        outcome: 'failure',
        actor: context.actor,
        tenantId: job.tenantId,
        correlationId: context.correlationId,
        requestId: context.requestId,
        resource: { type: 'ec2_async_job', id: job.jobId, accountId: job.accountId },
        reason: safeSummary,
      });
    } catch (error) {
      if (error instanceof RepositoryConflictError) {
        throw new Ec2AsyncJobConsumerRetryableError('Retry metadata conflict.');
      }
      throw error;
    }
  }

  private async markTerminalFailure(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
    safeSummary: string,
  ): Promise<Ec2AsyncJobRecord> {
    const updated = await this.deps.jobs.updateJob(
      job.tenantId,
      job.jobId,
      {
        status: 'FAILED',
        stage: job.stage,
        errorSummary: safeSummary,
        completedAt: new Date().toISOString(),
      },
      { expectedVersion: job.version },
    );
    await this.deps.jobs.appendEvent({
      tenantId: job.tenantId,
      jobId: job.jobId,
      eventType: EC2_ASYNC_JOB_EVENT.FAILED,
      correlationId: context.correlationId,
      status: updated.status,
      stage: updated.stage,
      errorSummary: safeSummary,
    });
    writeAuditEvent({
      eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_FAILED,
      outcome: 'failure',
      actor: context.actor,
      tenantId: job.tenantId,
      correlationId: context.correlationId,
      requestId: context.requestId,
      resource: { type: 'ec2_async_job', id: job.jobId, accountId: job.accountId },
      reason: safeSummary,
    });
    return updated;
  }

  private async recoverAdvanceStage(
    job: Ec2AsyncJobRecord,
    nextStage: Ec2AsyncJobRecord['stage'],
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    const updated = await this.advanceStage(job, nextStage, context);
    await this.deps.jobs.appendEvent({
      tenantId: job.tenantId,
      jobId: job.jobId,
      eventType: EC2_ASYNC_JOB_EVENT.STAGE_RECOVERED,
      correlationId: context.correlationId,
      status: updated.status,
      stage: updated.stage,
    });
    return updated;
  }

  private resolveProofBeforeExecution(proof: StageCompletionProof): void {
    if (proof.state === 'in_progress_active') {
      throw new Ec2AsyncJobConsumerRetryableError('Stage execution lease is active.');
    }
    if (proof.state === 'failed_permanent') {
      throw new Ec2AsyncJobConsumerTerminalError('Stage execution failed permanently.');
    }
    if (proof.state === 'ambiguous') {
      throw new Ec2AsyncJobConsumerRetryableError('Stage completion state is ambiguous.');
    }
  }

  private async runDiscoveryStage(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    const runId = ec2AsyncJobDiscoveryRunId(job.jobId);
    const proof = await this.deps.stageCompletion.discoveryRunProof(
      job.tenantId,
      job.accountId,
      runId,
    );
    if (stageProofIsComplete(proof)) {
      return this.recoverAdvanceStage(job, 'COST_ANALYSIS', context);
    }
    this.resolveProofBeforeExecution(proof);
    let resumeRunExpectedVersion: number | undefined;
    if (stageProofRequiresExecutionClaim(proof)) {
      const claim = await this.deps.stageExecution.claimDiscoveryExecution({
        jobId: job.jobId,
        tenantId: job.tenantId,
        accountId: job.accountId,
        regions: job.regions,
      });
      resumeRunExpectedVersion = claim.resumeRunExpectedVersion;
    }

    await this.deps.discovery.startDiscovery(
      job.tenantId,
      job.accountId,
      { regions: job.regions, runId, resumeRunExpectedVersion },
      context,
    );
    const after = await this.deps.stageCompletion.discoveryRunProof(
      job.tenantId,
      job.accountId,
      runId,
    );
    if (!stageProofIsComplete(after)) {
      throw new Ec2AsyncJobConsumerRetryableError('Discovery stage did not persist completion.');
    }
    return this.advanceStage(job, 'COST_ANALYSIS', context);
  }

  private async runCostStage(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    const runId = ec2AsyncJobCostRunId(job.jobId);
    const proof = await this.deps.stageCompletion.costRunProof(
      job.tenantId,
      job.accountId,
      runId,
    );
    if (stageProofIsComplete(proof)) {
      return this.recoverAdvanceStage(job, 'SECURITY_ANALYSIS', context);
    }
    this.resolveProofBeforeExecution(proof);
    let resumeRunExpectedVersion: number | undefined;
    if (stageProofRequiresExecutionClaim(proof)) {
      const claim = await this.deps.stageExecution.claimCostExecution({
        jobId: job.jobId,
        tenantId: job.tenantId,
        accountId: job.accountId,
        regions: job.regions,
      });
      resumeRunExpectedVersion = claim.resumeRunExpectedVersion;
    }

    await this.deps.cost.startCostAnalysis(
      job.tenantId,
      { accountId: job.accountId, regions: job.regions, runId, resumeRunExpectedVersion },
      context,
    );
    const after = await this.deps.stageCompletion.costRunProof(
      job.tenantId,
      job.accountId,
      runId,
    );
    if (!stageProofIsComplete(after)) {
      throw new Ec2AsyncJobConsumerRetryableError('Cost analysis stage did not persist completion.');
    }
    return this.advanceStage(job, 'SECURITY_ANALYSIS', context);
  }

  private async runSecurityStage(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    const runId = ec2AsyncJobSecurityRunId(job.jobId);
    const proof = await this.deps.stageCompletion.securityRunProof(
      job.tenantId,
      job.accountId,
      runId,
    );
    if (stageProofIsComplete(proof)) {
      return this.recoverAdvanceStage(job, 'GOVERNANCE_ANALYSIS', context);
    }
    this.resolveProofBeforeExecution(proof);
    let resumeRunExpectedVersion: number | undefined;
    if (stageProofRequiresExecutionClaim(proof)) {
      const claim = await this.deps.stageExecution.claimSecurityExecution({
        jobId: job.jobId,
        tenantId: job.tenantId,
        accountId: job.accountId,
        regions: job.regions,
      });
      resumeRunExpectedVersion = claim.resumeRunExpectedVersion;
    }

    await this.deps.security.startSecurityAnalysis(job.tenantId, {
      accountId: job.accountId,
      regions: job.regions,
      runId,
      resumeRunExpectedVersion,
    });
    const after = await this.deps.stageCompletion.securityRunProof(
      job.tenantId,
      job.accountId,
      runId,
    );
    if (!stageProofIsComplete(after)) {
      throw new Ec2AsyncJobConsumerRetryableError(
        'Security analysis stage did not persist completion.',
      );
    }
    return this.advanceStage(job, 'GOVERNANCE_ANALYSIS', context);
  }

  private async runGovernanceStage(
    job: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    const securityProof = await this.deps.stageCompletion.securityRunProof(
      job.tenantId,
      job.accountId,
      ec2AsyncJobSecurityRunId(job.jobId),
    );
    if (!stageProofIsComplete(securityProof)) {
      this.resolveProofBeforeExecution(securityProof);
      throw new Ec2AsyncJobConsumerRetryableError(
        'Governance stage requires completed security analysis output.',
      );
    }
    return this.advanceStage(job, 'FINALIZING', context);
  }

  async executeIntelligencePipeline(
    initialJob: Ec2AsyncJobRecord,
    context: Ec2AsyncJobWorkerCallContext,
  ): Promise<Ec2AsyncJobRecord> {
    let job = initialJob;

    if (job.status === 'SUCCEEDED' && job.stage === 'COMPLETE') {
      await this.deps.jobs.appendEvent({
        tenantId: job.tenantId,
        jobId: job.jobId,
        eventType: EC2_ASYNC_JOB_EVENT.DUPLICATE_SKIPPED,
        correlationId: context.correlationId,
        status: job.status,
        stage: job.stage,
      });
      return job;
    }

    if (job.status === 'FAILED') {
      return job;
    }

    if (job.status !== 'RUNNING' && job.status !== 'PARTIAL') {
      throw new Ec2AsyncJobConsumerTerminalError('Job is not runnable.');
    }

    for (let step = 0; step < 8; step += 1) {
      if (job.status === 'SUCCEEDED' && job.stage === 'COMPLETE') {
        return job;
      }

      switch (job.stage) {
        case 'DISCOVERY':
          job = await this.runDiscoveryStage(job, context);
          break;
        case 'COST_ANALYSIS':
          job = await this.runCostStage(job, context);
          break;
        case 'SECURITY_ANALYSIS':
          job = await this.runSecurityStage(job, context);
          break;
        case 'GOVERNANCE_ANALYSIS':
          job = await this.runGovernanceStage(job, context);
          break;
        case 'FINALIZING': {
          const completedAt = new Date().toISOString();
          job = await this.deps.jobs.updateJob(
            job.tenantId,
            job.jobId,
            {
              status: 'SUCCEEDED',
              stage: 'COMPLETE',
              completedAt,
              errorSummary: undefined,
            },
            { expectedVersion: job.version },
          );
          await this.deps.jobs.appendEvent({
            tenantId: job.tenantId,
            jobId: job.jobId,
            eventType: EC2_ASYNC_JOB_EVENT.SUCCEEDED,
            correlationId: context.correlationId,
            status: job.status,
            stage: job.stage,
          });
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_SUCCEEDED,
            outcome: 'success',
            actor: context.actor,
            tenantId: job.tenantId,
            correlationId: context.correlationId,
            requestId: context.requestId,
            resource: { type: 'ec2_async_job', id: job.jobId, accountId: job.accountId },
          });
          return job;
        }
        case 'COMPLETE':
          return job;
        default:
          throw new Ec2AsyncJobConsumerTerminalError('Unsupported job stage.');
      }
    }

    throw new Ec2AsyncJobConsumerRetryableError('Job stage progression exceeded guard limit.');
  }

  async processValidatedMessage(
    message: Ec2IntelligenceQueueMessage,
    processingRequestId: string,
  ): Promise<'ack' | 'retry'> {
    const context = createEc2AsyncJobWorkerCallContext({
      processingRequestId,
      correlationId: message.correlationId,
    });

    const loaded = await this.deps.jobs.getJob(message.tenantId, message.jobId);
    if (!loaded) {
      logger.warn(
        `Orphan SQS message jobId=${message.jobId} tenantId=${message.tenantId} correlationId=${message.correlationId}`,
      );
      return 'ack';
    }

    let job = loaded;

    try {
      await this.validateScopeAgainstDurableJob(message, job);
      await this.requireVerifiedAccount(job.tenantId, job.accountId);
    } catch (error) {
      const safeSummary = sanitizeConsumerErrorSummary(error);
      await this.deps.jobs.appendEvent({
        tenantId: job.tenantId,
        jobId: job.jobId,
        eventType: EC2_ASYNC_JOB_EVENT.INVALID_MESSAGE_REJECTED,
        correlationId: context.correlationId,
        status: job.status,
        stage: job.stage,
        errorSummary: safeSummary,
      });
      if (error instanceof Ec2AsyncJobConsumerTerminalError) {
        await this.markTerminalFailure(job, context, safeSummary);
      }
      return 'ack';
    }

    try {
      job = await this.claimOrReconcileJob(job, context);
      const latest = await this.deps.jobs.getJob(job.tenantId, job.jobId);
      if (latest) {
        job = latest;
      }
      if (job.status === 'SUCCEEDED' && job.stage === 'COMPLETE') {
        await this.executeIntelligencePipeline(job, context);
        return 'ack';
      }
      if (job.status === 'FAILED') {
        return 'ack';
      }
      await this.executeIntelligencePipeline(job, context);
      return 'ack';
    } catch (error) {
      const safeSummary = sanitizeConsumerErrorSummary(error);
      logger.error(
        `EC2 async job processing failed jobId=${job.jobId} tenantId=${job.tenantId} correlationId=${context.correlationId} errorName=${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
      );

      if (isRetryableConsumerError(error)) {
        await this.markRetrying(job, context, safeSummary);
        return 'retry';
      }

      if (error instanceof RepositoryConflictError) {
        try {
          await this.markRetrying(job, context, safeSummary);
        } catch {
          // Concurrent workers may collide again while recording retry metadata.
        }
        return 'retry';
      }

      if (error instanceof Ec2StageRunActiveLeaseError) {
        try {
          await this.markRetrying(job, context, safeSummary);
        } catch {
          // Concurrent workers may collide again while recording retry metadata.
        }
        return 'retry';
      }

      if (error instanceof Ec2AsyncJobConsumerTerminalError) {
        await this.markTerminalFailure(job, context, safeSummary);
        return 'ack';
      }

      await this.markRetrying(job, context, safeSummary);
      return 'retry';
    }
  }
}
