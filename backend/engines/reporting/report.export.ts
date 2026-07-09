/**
 * Report export structure — prepares export-ready models without file generation.
 * PDF and CSV export are future sprint work.
 */

import type { OptimizationReport, ReportExportOption } from '../../shared/types';

/** Export payload wrapper for future file generation pipelines. */
export interface ReportExportPayload {
  reportId: string;
  workflowId: string;
  format: 'json' | 'csv' | 'pdf';
  generatedAt: string;
  data: OptimizationReport;
}

/** Describes supported export formats for a report. */
export function buildExportOptions(): ReportExportOption[] {
  return [
    {
      format: 'json',
      available: true,
      description: 'Structured JSON export of the full optimization report',
    },
    {
      format: 'csv',
      available: false,
      description: 'Tabular CSV export — planned for a future sprint',
    },
    {
      format: 'pdf',
      available: false,
      description: 'Executive PDF export — planned for a future sprint',
    },
  ];
}

/**
 * Prepare an export-ready payload for the requested format.
 * Only JSON is available in MVP; other formats return structured placeholders.
 */
export function prepareExportPayload(
  report: OptimizationReport,
  format: 'json' | 'csv' | 'pdf'
): ReportExportPayload {
  return {
    reportId: report.reportId,
    workflowId: report.workflowId,
    format,
    generatedAt: new Date().toISOString(),
    data: report,
  };
}
