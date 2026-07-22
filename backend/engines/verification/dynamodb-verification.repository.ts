/**
 * DynamoDB-backed VerificationRepository.
 *
 * Single-table layout (all under the tenant partition):
 *   VERIFY#<workflowId>       verification output
 *   VERIFYEXEC#<executionId>  executionId -> workflowId pointer
 */

import {
  buildTenantPartitionKey,
  type PersistenceTable,
} from '../../persistence/persistence-table';
import type {
  VerificationOutput,
  VerificationRepository,
} from './verification.repository';

function verifySk(workflowId: string): string {
  return `VERIFY#${workflowId}`;
}

function executionPointerSk(executionId: string): string {
  return `VERIFYEXEC#${executionId}`;
}

export class DynamoDbVerificationRepository
  implements VerificationRepository
{
  constructor(private readonly table: PersistenceTable) {}

  async save(output: VerificationOutput): Promise<VerificationOutput> {
    const pk = buildTenantPartitionKey(output.tenantId);

    await this.table.putItem({
      pk,
      sk: verifySk(output.workflowId),
      entityType: 'verification-output',
      recordedAt: output.recordedAt,
      data: output,
    });

    await this.table.putItem({
      pk,
      sk: executionPointerSk(output.executionId),
      entityType: 'verification-execution-index',
      workflowId: output.workflowId,
    });

    return output;
  }

  async findByWorkflowId(
    tenantId: string,
    workflowId: string
  ): Promise<VerificationOutput | undefined> {
    const item = await this.table.getItem(
      buildTenantPartitionKey(tenantId),
      verifySk(workflowId)
    );

    return item?.data as VerificationOutput | undefined;
  }

  async findByExecutionId(
    tenantId: string,
    executionId: string
  ): Promise<VerificationOutput | undefined> {
    const pointer = await this.table.getItem(
      buildTenantPartitionKey(tenantId),
      executionPointerSk(executionId)
    );

    const workflowId = pointer?.workflowId as string | undefined;
    return workflowId
      ? this.findByWorkflowId(tenantId, workflowId)
      : undefined;
  }

  async list(tenantId: string): Promise<VerificationOutput[]> {
    const items = await this.table.queryByPrefix(
      buildTenantPartitionKey(tenantId),
      'VERIFY#'
    );

    return items
      .map((item) => item.data as VerificationOutput)
      .sort(
        (left, right) =>
          new Date(right.recordedAt).getTime() -
          new Date(left.recordedAt).getTime()
      );
  }
}
