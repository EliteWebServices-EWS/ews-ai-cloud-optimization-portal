import type { PageRequest, PageResult, UpdateOptions } from './repository-types';

import type { CostFindingRecord } from '../models';
import type { CostFindingStatus } from '../../shared/constants';

export type CreateCostFindingInput = Omit<
  CostFindingRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateCostFindingInput = Partial<
  Pick<CostFindingRecord, 'status' | 'metadata'>
>;

export interface CostFindingRepository {
  create(input: CreateCostFindingInput): Promise<CostFindingRecord>;

  get(tenantId: string, findingId: string): Promise<CostFindingRecord | undefined>;

  update(
    tenantId: string,
    findingId: string,
    changes: UpdateCostFindingInput,
    options: UpdateOptions,
  ): Promise<CostFindingRecord>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<CostFindingRecord>>;

  listByAccount(
    tenantId: string,
    accountId: string,
    page?: PageRequest,
  ): Promise<PageResult<CostFindingRecord>>;

  listByAnalysis(
    tenantId: string,
    analysisId: string,
  ): Promise<CostFindingRecord[]>;
}

export const INITIAL_COST_FINDING_STATUS: CostFindingStatus = 'OPEN';
