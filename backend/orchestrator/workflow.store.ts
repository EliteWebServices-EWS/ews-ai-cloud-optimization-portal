/**
 * In-memory workflow store for tracking workflow metadata and state.
 * Sprint 7: supports GET /workflows/:id without DynamoDB persistence.
 */

import type { WorkflowState } from '../shared/constants';
import type { WorkflowContext, WorkflowMetadata, WorkflowRecord, HardenedWorkflowResult } from './workflow.types';

/** Interface for workflow persistence — swappable for DynamoDB in future sprints. */
export interface WorkflowStoreInterface {
  save(record: WorkflowRecord): void;
  updateContext(workflowId: string, context: WorkflowContext): void;
  updateResult(workflowId: string, result: HardenedWorkflowResult): void;
  get(workflowId: string): WorkflowRecord | undefined;
  getMetadata(workflowId: string): WorkflowMetadata | undefined;
  list(status?: WorkflowState): WorkflowMetadata[];
}

/** In-memory workflow registry for Demo Mode workflow tracking. */
export class InMemoryWorkflowStore implements WorkflowStoreInterface {
  private readonly records = new Map<string, WorkflowRecord>();

  save(record: WorkflowRecord): void {
    this.records.set(record.metadata.workflowId, record);
  }

  updateContext(workflowId: string, context: WorkflowContext): void {
    const record = this.records.get(workflowId);
    if (!record) {
      return;
    }
    record.context = context;
    record.metadata.status = context.status;
    record.metadata.executionState = context.executionState;
    if (context.completedAt) {
      record.metadata.completedAt = context.completedAt;
    }
  }

  updateResult(workflowId: string, result: HardenedWorkflowResult): void {
    const record = this.records.get(workflowId);
    if (!record) {
      return;
    }
    record.result = result;
    record.metadata.status = result.status;
    record.metadata.executionState = result.executionState;
    record.metadata.completedAt = result.completedAt;
  }

  get(workflowId: string): WorkflowRecord | undefined {
    return this.records.get(workflowId);
  }

  getMetadata(workflowId: string): WorkflowMetadata | undefined {
    return this.records.get(workflowId)?.metadata;
  }

  list(status?: WorkflowState): WorkflowMetadata[] {
    const all = Array.from(this.records.values()).map((r) => r.metadata);
    if (!status) {
      return all;
    }
    return all.filter((m) => m.status === status);
  }
}

export function createWorkflowStore(): InMemoryWorkflowStore {
  return new InMemoryWorkflowStore();
}
