/**
 * Reporting Engine — aggregates workflow results into structured optimization reports.
 * Sprint 9: presentation and aggregation layer only.
 */

import type { OptimizationReport, ReportGenerationInput, Result } from '../../shared/types';
import { createLogger } from '../../shared/utils';
import { REPORT_ERROR_CODES, createReportError } from './report.errors';
import { generateReport } from './report.generator';
import { createReportStore, type ReportStoreInterface } from './report.store';

const logger = createLogger('ReportingEngine');

export interface ReportingEngineOptions {
  store?: ReportStoreInterface;
}

/** Maps a workflow record context into report generation input. */
export function toReportGenerationInput(
  record: {
    metadata: { workflowId: string; plugin: ReportGenerationInput['plugin']; region: string; completedAt?: string; status: ReportGenerationInput['status'] };
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
  private readonly store: ReportStoreInterface;

  constructor(options: ReportingEngineOptions = {}) {
    this.store = options.store ?? createReportStore();
  }

  /** Generate and persist an optimization report from workflow data. */
  execute(input: ReportGenerationInput): Result<OptimizationReport> {
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
      this.store.save(report);

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

  getReport(reportId: string): OptimizationReport | undefined {
    return this.store.get(reportId);
  }

  getReportByWorkflowId(workflowId: string): OptimizationReport | undefined {
    return this.store.getByWorkflowId(workflowId);
  }

  listReports(): OptimizationReport[] {
    return this.store.list();
  }

  getStore(): ReportStoreInterface {
    return this.store;
  }
}

export function createReportingEngine(options?: ReportingEngineOptions): ReportingEngine {
  return new ReportingEngine(options);
}

export { generateReport, generateExecutiveSummary, generateTechnicalSummary } from './report.generator';
export { filterReports, parseReportFilters } from './report.filter';
export { buildExportOptions, prepareExportPayload } from './report.export';
export type { ReportStoreInterface } from './report.store';
