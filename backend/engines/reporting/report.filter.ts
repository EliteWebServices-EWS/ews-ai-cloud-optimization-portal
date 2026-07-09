/**
 * Report filtering — basic list filtering by status, resource type, confidence, and verification.
 */

import type { OptimizationReport, ReportFilterCriteria } from '../../shared/types';

/** Apply filter criteria to a list of optimization reports. */
export function filterReports(
  reports: OptimizationReport[],
  criteria: ReportFilterCriteria
): OptimizationReport[] {
  return reports.filter((report) => matchesReportFilters(report, criteria));
}

function matchesReportFilters(
  report: OptimizationReport,
  criteria: ReportFilterCriteria
): boolean {
  if (criteria.status && report.status !== criteria.status) {
    return false;
  }

  if (criteria.plugin && report.plugin !== criteria.plugin) {
    return false;
  }

  if (criteria.resourceType) {
    const normalized = criteria.resourceType.toLowerCase();
    const hasType = report.resources.some(
      (resource) => resource.resourceType.toLowerCase() === normalized
    );
    if (!hasType) {
      return false;
    }
  }

  if (criteria.confidenceLevel) {
    const normalized = criteria.confidenceLevel.toUpperCase();
    const hasConfidence = report.recommendations.some(
      (entry) => entry.decision.confidenceStatus.toUpperCase() === normalized
    );
    if (!hasConfidence) {
      return false;
    }
  }

  if (criteria.verificationStatus) {
    const normalized = criteria.verificationStatus.toLowerCase();
    const verificationStatus = report.verification?.status?.toLowerCase() ?? '';
    if (verificationStatus !== normalized) {
      return false;
    }
  }

  return true;
}

/** Parse query string parameters into report filter criteria. */
export function parseReportFilters(query: Record<string, unknown>): ReportFilterCriteria {
  const criteria: ReportFilterCriteria = {};

  if (typeof query.status === 'string' && query.status.length > 0) {
    criteria.status = query.status as ReportFilterCriteria['status'];
  }
  if (typeof query.resourceType === 'string' && query.resourceType.length > 0) {
    criteria.resourceType = query.resourceType;
  }
  if (typeof query.confidenceLevel === 'string' && query.confidenceLevel.length > 0) {
    criteria.confidenceLevel = query.confidenceLevel;
  }
  if (typeof query.verificationStatus === 'string' && query.verificationStatus.length > 0) {
    criteria.verificationStatus = query.verificationStatus;
  }
  if (typeof query.plugin === 'string' && query.plugin.length > 0) {
    criteria.plugin = query.plugin as ReportFilterCriteria['plugin'];
  }

  return criteria;
}
