/**
 * Download optimization report JSON from the authoritative API payload.
 */

import type { OptimizationReport } from '../types';

export function buildReportJsonFilename(reportId: string): string {
  return `sisum-report-${reportId}.json`;
}

export function downloadOptimizationReportJson(report: OptimizationReport): void {
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildReportJsonFilename(report.reportId);
  anchor.click();
  URL.revokeObjectURL(url);
}
