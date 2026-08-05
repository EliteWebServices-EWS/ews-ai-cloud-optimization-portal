import { RepositoryConflictError, RepositoryNotFoundError } from '../database';
import { analyzeEc2Costs, type Ec2CostDataSource } from '../engines/cost-intelligence';
import type {
  AwsAccountRepository,
  CostFindingRepository,
  PageRequest,
  PageResult,
  UpdateOptions,
} from '../repositories/contracts';
import { INITIAL_COST_FINDING_STATUS } from '../repositories/contracts/cost-finding-repository';
import type { CostFindingRecord } from '../repositories/models';
import type { AuditActor } from '../audit';
import type { CostFindingStatus } from '../shared/constants';
import type { CostFinding, CostIntelligenceReport } from '../shared/types';
import { AppError, createLogger, generateCostAnalysisId } from '../shared/utils';

const logger = createLogger('CostIntelligenceApiService');

export interface CostIntelligenceRequestContext {
  tenantId: string;
  actor: AuditActor;
  requestId: string;
  correlationId: string;
}

export interface CostIntelligenceApiServiceDeps {
  costFindingRepository: CostFindingRepository;
  awsAccountRepository: AwsAccountRepository;
  dataSource: Ec2CostDataSource;
}

function toCreateInput(
  tenantId: string,
  analysisId: string,
  finding: CostFinding,
): Parameters<CostFindingRepository['create']>[0] {
  return {
    tenantId,
    findingId: finding.findingId,
    analysisId,
    accountId: finding.accountId,
    instanceId: finding.instanceId,
    instanceType: finding.instanceType,
    region: finding.region,
    findingType: finding.findingType,
    severity: finding.severity,
    status: INITIAL_COST_FINDING_STATUS,
    reason: finding.reason,
    tags: finding.tags,
    monthlySavings: Math.max(0, finding.financialImpact.monthlySavings),
    currency: finding.financialImpact.currency,
    financialImpact: finding.financialImpact as unknown as Record<string, unknown>,
    confidence: finding.confidence as unknown as Record<string, unknown>,
    metadata: finding.metadata,
  };
}

export class CostIntelligenceApiService {
  constructor(private readonly deps: CostIntelligenceApiServiceDeps) {}

  /**
   * Runs a full EC2 cost intelligence analysis for one tenant-owned AWS
   * account: load + validate the account, collect + classify + score
   * findings, persist each finding, and return the aggregate report.
   */
  async runAnalysis(
    accountId: string,
    context: CostIntelligenceRequestContext,
  ): Promise<CostIntelligenceReport> {
    const account = await this.deps.awsAccountRepository.getById(
      context.tenantId,
      accountId,
    );

    if (!account) {
      throw new AppError(
        'NOT_FOUND',
        'AWS account was not found.',
        404,
        'cost-intelligence-api',
      );
    }

    if (account.status !== 'VERIFIED') {
      throw new AppError(
        'ACCOUNT_NOT_VERIFIED',
        'The AWS account must be VERIFIED before it can be analyzed. Verify the account first.',
        409,
        'cost-intelligence-api',
      );
    }

    const analysisId = generateCostAnalysisId();

    logger.info(
      `EC2 cost intelligence analysis started: tenantId=${context.tenantId} ` +
        `accountId=${accountId} analysisId=${analysisId}`,
      { operation: 'runAnalysis' },
    );

    const collection = await this.deps.dataSource.collect({
      tenantId: context.tenantId,
      accountId,
      region: account.region,
      roleArn: account.roleArn,
      externalId: account.externalId,
      requestContext: {
        actor: context.actor,
        requestId: context.requestId,
        correlationId: context.correlationId,
      },
    });

    const report = await analyzeEc2Costs({
      analysisId,
      tenantId: context.tenantId,
      collection,
      dataSource: this.deps.dataSource,
    });

    for (const finding of report.findings) {
      await this.deps.costFindingRepository.create(
        toCreateInput(context.tenantId, analysisId, finding),
      );
    }

    return report;
  }

  async getFinding(
    tenantId: string,
    findingId: string,
  ): Promise<CostFindingRecord | undefined> {
    return this.deps.costFindingRepository.get(tenantId, findingId);
  }

  async listFindings(
    tenantId: string,
    page?: PageRequest,
    accountId?: string,
  ): Promise<PageResult<CostFindingRecord>> {
    if (accountId) {
      return this.deps.costFindingRepository.listByAccount(tenantId, accountId, page);
    }
    return this.deps.costFindingRepository.listByTenant(tenantId, page);
  }

  async listFindingsForAnalysis(
    tenantId: string,
    analysisId: string,
  ): Promise<CostFindingRecord[]> {
    return this.deps.costFindingRepository.listByAnalysis(tenantId, analysisId);
  }

  async updateFindingStatus(
    tenantId: string,
    findingId: string,
    status: CostFindingStatus,
    options: UpdateOptions,
  ): Promise<CostFindingRecord> {
    return this.deps.costFindingRepository.update(
      tenantId,
      findingId,
      { status },
      options,
    );
  }
}

export function mapCostIntelligenceServiceError(error: unknown): AppError | unknown {
  if (error instanceof RepositoryConflictError) {
    return new AppError(
      'CONFLICT',
      'Cost finding version conflict.',
      409,
      'cost-intelligence-api',
    );
  }
  if (error instanceof RepositoryNotFoundError) {
    return new AppError(
      'NOT_FOUND',
      'Cost finding was not found.',
      404,
      'cost-intelligence-api',
    );
  }
  return error;
}
