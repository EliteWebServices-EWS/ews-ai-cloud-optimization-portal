import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

import type { LearningRecord } from '../models';

export type CreateLearningInput = Omit<
  LearningRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateLearningInput = Partial<
  Omit<
    LearningRecord,
    | 'tenantId'
    | 'learningId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface LearningRepository {
  create(input: CreateLearningInput): Promise<LearningRecord>;

  get(
    tenantId: string,
    learningId: string,
  ): Promise<LearningRecord | undefined>;

  update(
    tenantId: string,
    learningId: string,
    changes: UpdateLearningInput,
    options: UpdateOptions,
  ): Promise<LearningRecord>;

  delete(
    tenantId: string,
    learningId: string,
    options?: UpdateOptions,
  ): Promise<void>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<LearningRecord>>;

  listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<LearningRecord>>;
}