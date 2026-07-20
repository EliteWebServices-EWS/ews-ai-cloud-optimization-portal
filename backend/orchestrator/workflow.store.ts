/**
 * In-memory workflow store for tracking workflow metadata and state.
 * Sprint 7: supports GET /workflows/:id without DynamoDB persistence.
 * Sprint 10.5.16: tenant-scoped lookups prevent cross-tenant access.
 */

import { recordBelongsToTenant } from '../auth/tenant';
import type { WorkflowState } from '../shared/constants';
import type { WorkflowContext, WorkflowMetadata, WorkflowRecord, HardenedWorkflowResult } from './workflow.types';

function buildStoreKey(tenantId: string, workflowId: string): string {
  return `${tenantId}:${workflowId}`;
}

/** Interface for workflow persistence — swappable for DynamoDB in future sprints. */
export interface WorkflowStoreInterface {
  save(record: WorkflowRecord): void;
  updateContext(tenantId: string, workflowId: string, context: WorkflowContext): void;
  updateResult(tenantId: string, workflowId: string, result: HardenedWorkflowResult): void;
  get(tenantId: string, workflowId: string): WorkflowRecord | undefined;
  getMetadata(tenantId: string, workflowId: string): WorkflowMetadata | undefined;
  list(tenantId: string, status?: WorkflowState): WorkflowMetadata[];
}

/** In-memory workflow registry for Demo Mode workflow tracking. */
export class InMemoryWorkflowStore implements WorkflowStoreInterface {
  private readonly records = new Map<string, WorkflowRecord>();

  save(record: WorkflowRecord): void {
    const key = buildStoreKey(
      record.metadata.tenantId,
      record.metadata.workflowId
    );
    this.records.set(key, record);
  }

  updateContext(tenantId: string, workflowId: string, context: WorkflowContext): void {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));
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

  updateResult(tenantId: string, workflowId: string, result: HardenedWorkflowResult): void {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));
    if (!record) {
      return;
    }
    record.result = result;
    record.metadata.status = result.status;
    record.metadata.executionState = result.executionState;
    record.metadata.completedAt = result.completedAt;
  }

  get(tenantId: string, workflowId: string): WorkflowRecord | undefined {
    const record = this.records.get(buildStoreKey(tenantId, workflowId));

    if (!record) {
      return undefined;
    }

    if (!recordBelongsToTenant(record.metadata.tenantId, tenantId)) {
      return undefined;
    }

    return record;
  }

  getMetadata(tenantId: string, workflowId: string): WorkflowMetadata | undefined {
    return this.get(tenantId, workflowId)?.metadata;
  }

  list(tenantId: string, status?: WorkflowState): WorkflowMetadata[] {
    const all = Array.from(this.records.values())
      .filter((record) =>
        recordBelongsToTenant(record.metadata.tenantId, tenantId)
      )
      .map((record) => record.metadata);

    if (!status) {
      return all;
    }

    return all.filter((metadata) => metadata.status === status);
  }
}

export function createWorkflowStore(): InMemoryWorkflowStore {
  return new InMemoryWorkflowStore();
}
