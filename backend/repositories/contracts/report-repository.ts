import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

import type { ReportRecord } from '../models';

export type CreateReportInput = Omit<
  ReportRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateReportInput = Partial<
  Omit<
    ReportRecord,
    | 'tenantId'
    | 'reportId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface ReportRepository {
  create(input: CreateReportInput): Promise<ReportRecord>;

  get(
    tenantId: string,
    reportId: string,
  ): Promise<ReportRecord | undefined>;

  update(
    tenantId: string,
    reportId: string,
    changes: UpdateReportInput,
    options: UpdateOptions,
  ): Promise<ReportRecord>;

  delete(
    tenantId: string,
    reportId: string,
    options?: UpdateOptions,
  ): Promise<void>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ReportRecord>>;

  listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<ReportRecord>>;
}