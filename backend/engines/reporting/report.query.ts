/**
 * Report querying — search, filtering, sorting, and pagination for
 * optimization reports.
 *
 * Pure functions so the mock repository can apply them in memory today and
 * a DynamoDB adapter can push the same semantics down to the database later.
 * Cursor tokens follow the audit-query convention: an opaque base64url
 * payload the client echoes back unchanged.
 */

import type { OptimizationReport, ReportFilterCriteria } from '../../shared/types';
import { filterReports, parseReportFilters } from './report.filter';

export const REPORT_SORT_FIELDS = [
  'createdAt',
  'estimatedMonthlySavings',
  'status',
  'workflowStatus',
] as const;

export type ReportSortField = (typeof REPORT_SORT_FIELDS)[number];

export type ReportSortOrder = 'asc' | 'desc';

export const DEFAULT_REPORT_QUERY_LIMIT = 50;
export const MAX_REPORT_QUERY_LIMIT = 100;

/** A validated report query — filters, free-text search, sort, and page. */
export interface ReportQuery {
  filters: ReportFilterCriteria;
  search?: string;
  sortBy: ReportSortField;
  sortOrder: ReportSortOrder;
  limit: number;
  nextToken?: string;
}

/** One page of query results plus the total match count. */
export interface ReportQueryResult {
  reports: OptimizationReport[];
  total: number;
  nextToken?: string;
}

export class ReportQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportQueryValidationError';
  }
}

/**
 * Parse and validate query-string parameters into a report query.
 * Throws ReportQueryValidationError for values a client must correct.
 */
export function parseReportQuery(
  query: Record<string, unknown>
): ReportQuery {
  const filters = parseReportFilters(query);

  const search =
    typeof query.search === 'string' && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;

  let sortBy: ReportSortField = 'createdAt';
  if (typeof query.sortBy === 'string' && query.sortBy.length > 0) {
    if (!REPORT_SORT_FIELDS.includes(query.sortBy as ReportSortField)) {
      throw new ReportQueryValidationError(
        `sortBy must be one of: ${REPORT_SORT_FIELDS.join(', ')}`
      );
    }
    sortBy = query.sortBy as ReportSortField;
  }

  let sortOrder: ReportSortOrder = sortBy === 'createdAt' ? 'desc' : 'asc';
  if (typeof query.sortOrder === 'string' && query.sortOrder.length > 0) {
    const normalized = query.sortOrder.toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      throw new ReportQueryValidationError(
        'sortOrder must be "asc" or "desc"'
      );
    }
    sortOrder = normalized;
  }

  let limit = DEFAULT_REPORT_QUERY_LIMIT;
  if (typeof query.limit === 'string' && query.limit.length > 0) {
    const parsed = Number(query.limit);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_REPORT_QUERY_LIMIT
    ) {
      throw new ReportQueryValidationError(
        `limit must be an integer between 1 and ${MAX_REPORT_QUERY_LIMIT}`
      );
    }
    limit = parsed;
  }

  const nextToken =
    typeof query.nextToken === 'string' && query.nextToken.length > 0
      ? query.nextToken
      : undefined;

  return { filters, search, sortBy, sortOrder, limit, nextToken };
}

/** Case-insensitive free-text search across report identity and summary fields. */
export function searchReports(
  reports: OptimizationReport[],
  term: string
): OptimizationReport[] {
  const needle = term.toLowerCase();

  return reports.filter((report) => {
    const haystacks = [
      report.reportId,
      report.workflowId,
      report.region,
      report.summary.headline,
      report.summary.executiveSummary,
      ...report.resources.flatMap((resource) => [
        resource.resourceId,
        resource.resourceType,
      ]),
      ...report.recommendations.map(
        (recommendation) => recommendation.resourceId
      ),
    ];

    return haystacks.some(
      (value) =>
        typeof value === 'string' &&
        value.toLowerCase().includes(needle)
    );
  });
}

function compareByField(
  left: OptimizationReport,
  right: OptimizationReport,
  sortBy: ReportSortField
): number {
  switch (sortBy) {
    case 'createdAt':
      return (
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime()
      );
    case 'estimatedMonthlySavings':
      return (
        left.summary.estimatedMonthlySavings -
        right.summary.estimatedMonthlySavings
      );
    case 'status':
      return left.status.localeCompare(right.status);
    case 'workflowStatus':
      return left.workflowStatus.localeCompare(right.workflowStatus);
  }
}

/** Sort reports by the requested field with a stable createdAt/reportId tie-break. */
export function sortReports(
  reports: OptimizationReport[],
  sortBy: ReportSortField,
  sortOrder: ReportSortOrder
): OptimizationReport[] {
  const direction = sortOrder === 'asc' ? 1 : -1;

  return [...reports].sort((left, right) => {
    const primary = compareByField(left, right, sortBy) * direction;
    if (primary !== 0) {
      return primary;
    }

    const byCreated =
      new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime();
    if (byCreated !== 0) {
      return byCreated;
    }

    return left.reportId.localeCompare(right.reportId);
  });
}

interface ReportPageCursor {
  offset: number;
}

function encodePageCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({ offset } satisfies ReportPageCursor),
    'utf8'
  ).toString('base64url');
}

function decodePageCursor(token: string | undefined): number {
  if (!token) {
    return 0;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8')
    ) as Partial<ReportPageCursor> | null;

    if (
      typeof parsed?.offset === 'number' &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return parsed.offset;
    }
  } catch {
    // Malformed tokens fall through to the first page.
  }

  return 0;
}

/** Slice a sorted result set into one page with an opaque continuation token. */
export function paginateReports(
  reports: OptimizationReport[],
  limit: number,
  nextToken?: string
): ReportQueryResult {
  const offset = decodePageCursor(nextToken);
  const page = reports.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    reports: page,
    total: reports.length,
    nextToken:
      nextOffset < reports.length
        ? encodePageCursor(nextOffset)
        : undefined,
  };
}

/** Apply search, filters, sorting, and pagination to a tenant's reports. */
export function applyReportQuery(
  reports: OptimizationReport[],
  query: ReportQuery
): ReportQueryResult {
  const searched = query.search
    ? searchReports(reports, query.search)
    : reports;

  const filtered = filterReports(searched, query.filters);
  const sorted = sortReports(filtered, query.sortBy, query.sortOrder);

  return paginateReports(sorted, query.limit, query.nextToken);
}
