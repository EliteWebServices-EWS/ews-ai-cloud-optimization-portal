import type { Ec2AsyncJobRecord } from '../async-jobs/ec2-async-job-models';
import type { ReportingEngine } from '../engines/reporting/report.engine';
import { buildEc2AsyncOptimizationReport } from '../engines/reporting/ec2-async-report.generator';
import type { Ec2CostRecommendationRepository, Ec2CostAnalysisRunRepository } from '../repositories/contracts/ec2-cost-repository';
import type { Ec2DiscoveryRunRepository } from '../repositories/contracts/ec2-cloud-resource-repository';
import type {
  Ec2SecurityAnalysisRunRepository,
  Ec2SecurityFindingRepository,
  Ec2SecuritySummaryRepository,
} from '../repositories/contracts/ec2-security-repository';
import type { OptimizationReport } from '../shared/types';
import type { Ec2CostRecommendationRecord } from '../cloud-intelligence/ec2-cost/ec2-cost-models';
import {
  ec2AsyncJobCostRunId,
  ec2AsyncJobDiscoveryRunId,
  ec2AsyncJobSecurityRunId,
} from './ec2-async-job-stage-runs';
import { Ec2AsyncJobConsumerRetryableError } from './ec2-async-job-consumer-errors';
import { RepositoryConflictError } from '../database';

export interface Ec2AsyncReportProjectionServiceDeps {
  reportingEngine: ReportingEngine;
  discoveryRuns: Ec2DiscoveryRunRepository;
  costRuns: Ec2CostAnalysisRunRepository;
  costRecommendations: Ec2CostRecommendationRepository;
  securityRuns: Ec2SecurityAnalysisRunRepository;
  securitySummaries: Ec2SecuritySummaryRepository;
  securityFindings: Ec2SecurityFindingRepository;
}

export class Ec2AsyncReportProjectionService {
  constructor(private readonly deps: Ec2AsyncReportProjectionServiceDeps) {}

  async projectReportForCompletedJob(job: Ec2AsyncJobRecord): Promise<OptimizationReport> {
    const existing = await this.deps.reportingEngine.getReportByEc2AsyncJobId(
      job.tenantId,
      job.jobId,
    );
    if (existing) {
      return existing;
    }

    const report = await this.buildReport(job);
    try {
      return await this.deps.reportingEngine.saveEc2AsyncReportIfAbsent(report);
    } catch (error) {
      if (error instanceof RepositoryConflictError) {
        const raced = await this.deps.reportingEngine.getReportByEc2AsyncJobId(
          job.tenantId,
          job.jobId,
        );
        if (raced) {
          return raced;
        }
      }

      const reason = error instanceof Error ? error.message : 'Report persistence failed';
      throw new Ec2AsyncJobConsumerRetryableError(
        `EC2 async report projection failed: ${reason}`,
      );
    }
  }

  private async buildReport(job: Ec2AsyncJobRecord): Promise<OptimizationReport> {
    const discoveryRunId = ec2AsyncJobDiscoveryRunId(job.jobId);
    const costRunId = ec2AsyncJobCostRunId(job.jobId);
    const securityRunId = ec2AsyncJobSecurityRunId(job.jobId);

    const [discoveryRun, costRun, securityRun, securitySummaries, recommendations] =
      await Promise.all([
        this.deps.discoveryRuns.getRun(job.tenantId, job.accountId, discoveryRunId),
        this.deps.costRuns.getRun(job.tenantId, job.accountId, costRunId),
        this.deps.securityRuns.getRun(job.tenantId, job.accountId, securityRunId),
        this.deps.securitySummaries.listSummariesForAccount(job.tenantId, job.accountId),
        this.listRecommendationsForRun(job.tenantId, job.accountId, costRunId),
      ]);

    const runSummaries = securitySummaries.filter(
      (summary) => summary.analysisRunId === securityRunId,
    );
    const securityRunCompleted = securityRun?.status === 'SUCCEEDED' || securityRun?.status === 'PARTIAL';
    const openFindingKeys = securityRunCompleted
      ? await this.deps.securityFindings.listOpenFindingKeys(
          job.tenantId,
          job.accountId,
          securityRunId,
        )
      : [];

    return buildEc2AsyncOptimizationReport({
      job,
      discoveryRun,
      costRun,
      securityRunCompleted,
      securitySummaries: runSummaries.length > 0 ? runSummaries : securitySummaries,
      openSecurityFindingCount: openFindingKeys.length,
      recommendations,
    });
  }

  private async listRecommendationsForRun(
    tenantId: string,
    accountId: string,
    analysisRunId: string,
  ): Promise<Ec2CostRecommendationRecord[]> {
    const collected: Ec2CostRecommendationRecord[] = [];
    let nextToken: string | undefined;

    do {
      const page = await this.deps.costRecommendations.listRecommendations({
        tenantId,
        accountId,
        lifecycleStatus: 'OPEN',
        limit: 100,
        nextToken,
      });
      collected.push(...page.items.filter((item) => item.analysisRunId === analysisRunId));
      nextToken = page.nextToken;
    } while (nextToken);

    return collected;
  }
}
