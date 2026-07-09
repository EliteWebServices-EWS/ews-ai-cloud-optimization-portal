/**
 * Report API client — communicates with backend reporting endpoints.
 */

import { apiRequest } from './client';
import type { OptimizationReport, ReportListItem, ReportFilterParams } from '../types';

export async function listReports(filters: ReportFilterParams = {}): Promise<{
  reports: ReportListItem[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.confidenceLevel) params.set('confidenceLevel', filters.confidenceLevel);
  if (filters.verificationStatus) params.set('verificationStatus', filters.verificationStatus);
  if (filters.plugin) params.set('plugin', filters.plugin);

  const query = params.toString();
  const path = query ? `/reports?${query}` : '/reports';
  return apiRequest<{ reports: ReportListItem[]; total: number }>(path);
}

export async function getReport(reportId: string): Promise<OptimizationReport> {
  return apiRequest<OptimizationReport>(`/reports/${reportId}`);
}

export async function generateReport(workflowId: string): Promise<{
  report: OptimizationReport;
  cached: boolean;
}> {
  return apiRequest<{ report: OptimizationReport; cached: boolean }>('/reports/generate', {
    method: 'POST',
    body: JSON.stringify({ workflowId }),
  });
}
