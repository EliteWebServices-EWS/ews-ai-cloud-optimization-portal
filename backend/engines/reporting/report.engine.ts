/**
 * Reporting Engine — aggregates workflow results into structured optimization reports.
 * Sprint 9: presentation and aggregation layer only.
 */

import type { OptimizationReport, ReportGenerationInput, Result } from '../../shared/types';
import { createLogger } from '../../shared/utils';
import { REPORT_ERROR_CODES, createReportError } from './report.errors';
import { generateReport } from './report.generator';
import { getReportsTable, getOwnershipTable } from '../../persistence/persistence-table';
import { shouldUseDurablePersistence } from '../../persistence/persistence-config';
import { MockReportRepository } from './mock-report.repository';
import { DynamoDbReportRepository } from './dynamodb-report.repository';
import type { ReportRepository } from './report.repository';
import type { ReportQuery, ReportQueryResult } from './report.query';

const logger = createLogger('ReportingEngine');

export interface ReportingEngineOptions {
  repository?: ReportRepository;
}

/** Maps a workflow record context into report generation input. */
export function toReportGenerationInput(
  record: {
    metadata: { tenantId: string; workflowId: string; plugin: ReportGenerationInput['plugin']; region: string; completedAt?: string; status: ReportGenerationInput['status'] };
    context: {
      candidate?: ReportGenerationInput['candidate'];
      evidence?: ReportGenerationInput['evidence'];
      evidenceStatus?: ReportGenerationInput['evidenceStatus'];
      validation?: ReportGenerationInput['validation'];
      governance?: ReportGenerationInput['governance'];
      readiness?: ReportGenerationInput['readiness'];
      financialImpact?: ReportGenerationInput['financialImpact'];
      confidence?: ReportGenerationInput['confidence'];
      recommendation?: ReportGenerationInput['recommendation'];
      execution?: ReportGenerationInput['execution'];
      observation?: ReportGenerationInput['observation'];
      verification?: ReportGenerationInput['verification'];
      report?: ReportGenerationInput['verificationReport'];
      completedAt?: string;
    };
  }
): ReportGenerationInput {
  return {
    tenantId: record.metadata.tenantId,
    workflowId: record.metadata.workflowId,
    plugin: record.metadata.plugin,
    status: record.metadata.status,
    region: record.metadata.region,
    completedAt: record.context.completedAt ?? record.metadata.completedAt,
    candidate: record.context.candidate,
    evidence: record.context.evidence,
    evidenceStatus: record.context.evidenceStatus,
    validation: record.context.validation,
    governance: record.context.governance,
    readiness: record.context.readiness,
    financialImpact: record.context.financialImpact,
    confidence: record.context.confidence,
    recommendation: record.context.recommendation,
    execution: record.context.execution,
    observation: record.context.observation,
    verification: record.context.verification,
    verificationReport: record.context.report,
  };
}

/**
 * Reporting Engine — converts workflow results into structured reports.
 * Does not calculate savings, modify recommendations, or call providers.
 */
export class ReportingEngine {
  readonly name = 'Reporting Engine';
  private readonly repository: ReportRepository;

  constructor(options: ReportingEngineOptions = {}) {
    this.repository = options.repository ?? new MockReportRepository();
  }

  /** Generate and persist an optimization report from workflow data. */
  async execute(
    input: ReportGenerationInput
  ): Promise<Result<OptimizationReport>> {
    const start = Date.now();

    logger.info('Report generation started', {
      workflowId: input.workflowId,
      operation: 'execute',
      status: 'started',
    });

    try {
      if (!input.workflowId) {
        return {
          success: false,
          error: createReportError(
            REPORT_ERROR_CODES.MISSING_WORKFLOW,
            'Workflow ID is required for report generation',
            'Provide a valid workflowId from a completed optimization workflow'
          ),
        };
      }

      const report = generateReport(input);
      await this.repository.save(report);

      logger.info('Report generated', {
        workflowId: input.workflowId,
        reportId: report.reportId,
        operation: 'execute',
        durationMs: Date.now() - start,
        status: report.status,
      });

      return { success: true, data: report };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Report generation failed';

      logger.error('Report failed', {
        workflowId: input.workflowId,
        operation: 'execute',
        durationMs: Date.now() - start,
        status: 'failed',
      });

      return {
        success: false,
        error: createReportError(
          REPORT_ERROR_CODES.REPORT_GENERATION_FAILED,
          reason,
          'Verify workflow data completeness and retry report generation'
        ),
      };
    }
  }

  getReport(
    tenantId: string,
    reportId: string
  ): Promise<OptimizationReport | undefined> {
    return this.repository.findById(tenantId, reportId);
  }

  getReportByWorkflowId(
    tenantId: string,
    workflowId: string
  ): Promise<OptimizationReport | undefined> {
    return this.repository.findByWorkflowId(tenantId, workflowId);
  }

  resolveReportOwnerTenantId(
    reportId: string
  ): Promise<string | undefined> {
    return this.repository.resolveOwnerTenantId(reportId);
  }

  resolveReportOwnerTenantIdByWorkflow(
    workflowId: string
  ): Promise<string | undefined> {
    return this.repository.resolveOwnerTenantIdByWorkflow(workflowId);
  }

  listReports(tenantId: string): Promise<OptimizationReport[]> {
    return this.repository.list(tenantId);
  }

  queryReports(
    tenantId: string,
    query: ReportQuery
  ): Promise<ReportQueryResult> {
    return this.repository.query(tenantId, query);
  }

  getRepository(): ReportRepository {
    return this.repository;
  }
}

export function createReportingEngine(options?: ReportingEngineOptions): ReportingEngine {
  if (options?.repository) {
    return new ReportingEngine(options);
  }

  const table = getReportsTable();
  const ownershipTable = getOwnershipTable();
  const useDurable = shouldUseDurablePersistence() && table && ownershipTable;

  return new ReportingEngine({
    ...options,
    repository:
      useDurable
        ? new DynamoDbReportRepository(table, ownershipTable)
        : undefined,
  });
}

export { generateReport, generateExecutiveSummary, generateTechnicalSummary } from './report.generator';
export { filterReports, parseReportFilters } from './report.filter';
export { buildExportOptions, prepareExportPayload } from './report.export';
export type { ReportRepository } from './report.repository';
