import { randomUUID } from 'node:crypto';

import { RepositoryNotFoundError } from '../database';
import type { AwsAccountRepository } from '../repositories/contracts';
import type { Ec2CloudResourceRepository } from '../repositories/contracts/ec2-cloud-resource-repository';
import type {
  Ec2CostAnalysisRunRepository,
  Ec2CostRecommendationListQuery,
  Ec2CostRecommendationRepository,
} from '../repositories/contracts/ec2-cost-repository';
import {
  parseEc2CostAccountId,
  parseEc2CostRegion,
} from '../api/ec2-cost-request-validators';
import {
  StsCredentialProvider,
  type AwsAccountRoleConfig,
  type StsAssumeRoleContext,
} from '../execution/adapters/sts';
import { AppError } from '../shared/utils';
import {
  EC2_COST_DEFAULT_OBSERVATION_DAYS,
  EC2_COST_MAX_OBSERVATION_DAYS,
  EC2_COST_MAX_REGIONS_PER_REQUEST,
  EC2_COST_MIN_OBSERVATION_DAYS,
} from '../cloud-intelligence/ec2-cost/ec2-cost-limits';
import { Ec2CostAnalysisOrchestrator } from '../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import { createEc2CostCloudWatchClientFactory } from '../cloud-intelligence/ec2-cost/ec2-cost-cloudwatch-factory';
import type { Ec2PerformanceMetricsClientFactory } from '../cloud-intelligence/ec2-cost/ec2-performance-metrics-client.port';
import type { AuditActor } from '../audit';
import type { EvidencePersistenceService } from './evidence-persistence-service';

export class Ec2CostValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2CostValidationError';
  }
}

export interface Ec2CostCallContext {
  actor: AuditActor;
  requestId: string;
  correlationId: string;
}

export interface StartEc2CostAnalysisInput {
  accountId: string;
  regions?: string[];
  observationDays?: number;
  /** When set (async worker), reuses a stable run id for idempotent stage recovery. */
  runId?: string;
  resumeRunExpectedVersion?: number;
  /** Async intelligence job identifier when invoked from the EC2 job consumer. */
  jobId?: string;
}

function dedupeRegions(regions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const region of regions) {
    const normalized = parseEc2CostRegion(region);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

export function resolveEc2CostAnalysisRegions(
  input: StartEc2CostAnalysisInput,
  accountRegion: string,
): string[] {
  const requested =
    input.regions && input.regions.length > 0
      ? dedupeRegions(input.regions)
      : [parseEc2CostRegion(accountRegion)];

  if (requested.length > EC2_COST_MAX_REGIONS_PER_REQUEST) {
    throw new Ec2CostValidationError(
      `At most ${EC2_COST_MAX_REGIONS_PER_REQUEST} regions are allowed per cost analysis request.`,
    );
  }
  return requested;
}

export function validateObservationDays(value: number | undefined): number {
  const days = value ?? EC2_COST_DEFAULT_OBSERVATION_DAYS;
  if (!Number.isInteger(days) || days < EC2_COST_MIN_OBSERVATION_DAYS || days > EC2_COST_MAX_OBSERVATION_DAYS) {
    throw new Ec2CostValidationError(
      `observationDays must be an integer between ${EC2_COST_MIN_OBSERVATION_DAYS} and ${EC2_COST_MAX_OBSERVATION_DAYS}.`,
    );
  }
  return days;
}

export class Ec2CostAnalysisApiService {
  constructor(
    private readonly awsAccounts: AwsAccountRepository,
    private readonly resources: Ec2CloudResourceRepository,
    private readonly recommendations: Ec2CostRecommendationRepository,
    private readonly runs: Ec2CostAnalysisRunRepository,
    private readonly credentialProvider: StsCredentialProvider = new StsCredentialProvider(),
    private readonly metricsClientFactoryOverride?: Ec2PerformanceMetricsClientFactory,
    private readonly evidencePersistence?: EvidencePersistenceService,
  ) {}

  private async requireVerifiedAccount(tenantId: string, accountId: string) {
    const normalizedAccountId = parseEc2CostAccountId(accountId);
    const record = await this.awsAccounts.getById(tenantId, normalizedAccountId);
    if (!record) {
      throw new RepositoryNotFoundError('AWS account connection not found.');
    }
    if (record.status !== 'VERIFIED') {
      throw new AppError(
        'AWS_ACCOUNT_NOT_VERIFIED',
        'AWS account must be VERIFIED before EC2 cost analysis.',
        409,
      );
    }
    return record;
  }

  private buildOrchestrator(): Ec2CostAnalysisOrchestrator {
    return new Ec2CostAnalysisOrchestrator(
      this.resources,
      this.recommendations,
      this.runs,
      this.evidencePersistence,
    );
  }

  async startCostAnalysis(
    tenantId: string,
    input: StartEc2CostAnalysisInput,
    context: Ec2CostCallContext,
  ) {
    const account = await this.requireVerifiedAccount(tenantId, input.accountId);
    const regions = resolveEc2CostAnalysisRegions(input, account.region);
    const observationDays = validateObservationDays(input.observationDays);

    const roleConfig: AwsAccountRoleConfig = {
      tenantId,
      roleArn: account.roleArn,
      externalId: account.externalId,
      sessionNamePrefix: 'sisum-ec2-cost',
    };
    const stsContext: StsAssumeRoleContext = {
      actorId: context.actor.userId ?? 'unknown',
      actor: context.actor,
      requestId: context.requestId,
      correlationId: context.correlationId,
    };

    const metricsClientFactory =
      this.metricsClientFactoryOverride ??
      createEc2CostCloudWatchClientFactory(roleConfig, {
        credentialProvider: this.credentialProvider,
        auditContext: stsContext,
        tenantId,
        accountId: account.accountId,
      });

    const orchestrator = this.buildOrchestrator();
    const runId = input.runId ?? `ec2cost-${randomUUID()}`;
    const now = new Date().toISOString();

    try {
      const result = await orchestrator.run({
        tenantId,
        accountId: account.accountId,
        regions,
        observationDays,
        runId,
        requestedAt: now,
        startedAt: now,
        metricsClientFactory,
        resumeRunExpectedVersion: input.resumeRunExpectedVersion,
        correlationId: context.correlationId,
        jobId: input.jobId,
      });
      return {
        runId: result.runId,
        status: result.status,
        accountId: account.accountId,
        regions,
        observationDays,
        instancesFound: result.instancesFound,
        instancesEvaluated: result.instancesEvaluated,
        recommendationCounts: result.recommendationCounts,
        recommendationsCreated: result.recommendationsCreated,
        recommendationsUpdated: result.recommendationsUpdated,
        recommendationsResolved: result.recommendationsResolved,
        insufficientDataCount: result.insufficientDataCount,
        warnings: result.warnings,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'EC2_COST_INSTANCE_LIMIT_EXCEEDED') {
        throw new Ec2CostValidationError(
          'At most 100 ACTIVE EC2 instances are supported per cost analysis request.',
        );
      }
      throw error;
    }
  }

  async listRecommendations(query: Ec2CostRecommendationListQuery) {
    parseEc2CostAccountId(query.accountId);
    if (query.region) {
      parseEc2CostRegion(query.region);
    }
    return this.recommendations.listRecommendations(query);
  }

  async getRecommendation(tenantId: string, accountId: string, recommendationId: string) {
    parseEc2CostAccountId(accountId);
    const record = await this.recommendations.getRecommendation(
      tenantId,
      accountId,
      recommendationId,
    );
    if (!record) {
      throw new RepositoryNotFoundError('EC2 cost recommendation not found.');
    }
    return record;
  }
}
