/** In-memory VerificationRepository implementation for development and unit tests. */
import type { VerificationOutput, VerificationRepository } from './verification.repository';

function key(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Models the tenant partitioning required of a durable verification adapter. */
export class MockVerificationRepository implements VerificationRepository {
  private readonly outputs = new Map<string, VerificationOutput>();
  private readonly executionIndex = new Map<string, string>();

  async save(output: VerificationOutput): Promise<VerificationOutput> {
    const stored = clone(output);
    this.outputs.set(key(stored.tenantId, stored.workflowId), stored);
    this.executionIndex.set(key(stored.tenantId, stored.executionId), stored.workflowId);
    return clone(stored);
  }

  async findByWorkflowId(tenantId: string, workflowId: string): Promise<VerificationOutput | undefined> {
    const output = this.outputs.get(key(tenantId, workflowId));
    return output ? clone(output) : undefined;
  }

  async findByExecutionId(tenantId: string, executionId: string): Promise<VerificationOutput | undefined> {
    const workflowId = this.executionIndex.get(key(tenantId, executionId));
    return workflowId ? this.findByWorkflowId(tenantId, workflowId) : undefined;
  }

  async list(tenantId: string): Promise<VerificationOutput[]> {
    return Array.from(this.outputs.values())
      .filter((output) => output.tenantId === tenantId)
      .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())
      .map(clone);
  }
}
