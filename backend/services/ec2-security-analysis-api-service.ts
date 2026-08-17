import type { AwsAccountRepository } from '../repositories/contracts';
import type { Ec2CloudResourceRepository } from '../repositories/contracts/ec2-cloud-resource-repository';
import type {
  Ec2SecurityAnalysisRunRepository,
  Ec2SecurityFindingListQuery,
  Ec2SecurityFindingRepository,
  Ec2SecuritySummaryRepository,
} from '../repositories/contracts/ec2-security-repository';
import { RepositoryNotFoundError, InvalidPaginationTokenError } from '../database';
import { AppError } from '../shared/utils';
import type { AuditActor } from '../audit';
import {
  parseEc2CostAccountId,
  parseEc2CostRegion,
} from '../api/ec2-cost-request-validators';
import {
  resolveEc2CostAnalysisRegions,
  type StartEc2CostAnalysisInput,
} from './ec2-cost-analysis-api-service';
import { Ec2SecurityAnalysisOrchestrator } from '../cloud-intelligence/ec2-security/ec2-security-analysis-orchestrator';
import type { Ec2GovernancePolicy } from '../engines/ec2-security';
import {
  buildAccountSecuritySummaryView,
  buildRegionSecuritySummaryView,
} from '../cloud-intelligence/ec2-security/ec2-security-summary-aggregate';
import type { Ec2SecuritySummaryView } from '../cloud-intelligence/ec2-security/ec2-security-summary-aggregate';
import type { GovernanceConvergenceService } from './governance-convergence-service';

export class Ec2SecurityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2SecurityValidationError';
  }
}

export interface Ec2SecurityCallContext {
  actor: AuditActor;
  requestId: string;
  correlationId: string;
}

export interface StartEc2SecurityAnalysisInput {
  accountId: string;
  regions?: string[];
  policy?: Ec2GovernancePolicy;
  /** When set (async worker), reuses a stable run id for idempotent stage recovery. */
  runId?: string;
  resumeRunExpectedVersion?: number;
}

export class Ec2SecurityAnalysisApiService {
  constructor(
    private readonly awsAccounts: AwsAccountRepository,
    private readonly resources: Ec2CloudResourceRepository,
    private readonly findings: Ec2SecurityFindingRepository,
    private readonly summaries: Ec2SecuritySummaryRepository,
    private readonly runs: Ec2SecurityAnalysisRunRepository,
    private readonly governanceConvergence?: GovernanceConvergenceService,
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
        'AWS account must be VERIFIED before EC2 security analysis.',
        409,
      );
    }
    return record;
  }

  async resolveSecurityAnalysisPreconditions(
    tenantId: string,
    input: StartEc2SecurityAnalysisInput,
  ): Promise<{ accountId: string; regions: string[] }> {
    const account = await this.requireVerifiedAccount(tenantId, input.accountId);
    const regions = resolveEc2CostAnalysisRegions(
      input as StartEc2CostAnalysisInput,
      account.region,
    );
    return { accountId: account.accountId, regions };
  }

  async startSecurityAnalysis(tenantId: string, input: StartEc2SecurityAnalysisInput) {
    const { accountId, regions } = await this.resolveSecurityAnalysisPreconditions(
      tenantId,
      input,
    );
    const orchestrator = new Ec2SecurityAnalysisOrchestrator(
      this.resources,
      this.findings,
      this.summaries,
      this.runs,
      this.governanceConvergence,
    );
    const result = await orchestrator.runAnalysis({
      tenantId,
      accountId,
      regions,
      policy: input.policy,
      runId: input.runId,
      resumeRunExpectedVersion: input.resumeRunExpectedVersion,
    });
    return {
      runId: result.run.runId,
      status: result.run.status,
      accountId,
      regions,
      summary: result.summary,
      instancesFound: result.run.instancesFound,
      instancesAnalyzed: result.run.instancesAnalyzed,
      findingsCreated: result.run.findingsCreated,
      findingsUpdated: result.run.findingsUpdated,
      findingsResolved: result.run.findingsResolved,
      warnings: result.summary.warnings,
    };
  }

  async listSecurityFindings(query: Ec2SecurityFindingListQuery) {
    parseEc2CostAccountId(query.accountId);
    if (query.region) {
      parseEc2CostRegion(query.region);
    }
    try {
      return await this.findings.listFindings(query);
    } catch (error) {
      if (error instanceof InvalidPaginationTokenError) {
        throw new Ec2SecurityValidationError('Invalid pagination token.');
      }
      throw error;
    }
  }

  async getSecuritySummary(
    tenantId: string,
    accountId: string,
    region?: string,
  ): Promise<Ec2SecuritySummaryView> {
    parseEc2CostAccountId(accountId);
    const normalizedRegion = region ? parseEc2CostRegion(region) : undefined;
    const openFindings = await this.findings.listFindings({
      tenantId,
      accountId,
      status: 'OPEN',
      limit: 500,
    });

    if (normalizedRegion) {
      const summary = await this.summaries.getLatestSummary(
        tenantId,
        accountId,
        normalizedRegion,
      );
      if (!summary) {
        throw new RepositoryNotFoundError(
          'No EC2 security summary found. Run POST /api/v1/analysis/ec2/security first.',
        );
      }
      return buildRegionSecuritySummaryView(summary, openFindings.items);
    }

    const summaries = await this.summaries.listSummariesForAccount(tenantId, accountId);
    const aggregated = buildAccountSecuritySummaryView(summaries, openFindings.items);
    if (!aggregated) {
      throw new RepositoryNotFoundError(
        'No EC2 security summary found. Run POST /api/v1/analysis/ec2/security first.',
      );
    }
    return aggregated;
  }
}
