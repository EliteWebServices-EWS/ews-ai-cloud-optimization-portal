/**
 * DynamoDB-backed VerificationRepository.
 */

import {
  buildTenantPartitionKey,
  type PersistedItem,
  type PersistenceTable,
} from '../../persistence/persistence-table';
import { computeExpiresAt, VERIFICATION_RETENTION_SECONDS } from '../../persistence/retention';
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
    const expiresAt = computeExpiresAt(VERIFICATION_RETENTION_SECONDS);

    const verifyItem: PersistedItem = {
      pk,
      sk: verifySk(output.workflowId),
      entityType: 'verification-output',
      recordedAt: output.recordedAt,
      expiresAt,
      data: output,
    };

    const pointerItem: PersistedItem = {
      pk,
      sk: executionPointerSk(output.executionId),
      entityType: 'verification-execution-index',
      workflowId: output.workflowId,
      expiresAt,
    };

    await this.table.transactPutItems([
      { item: verifyItem },
      { item: pointerItem },
    ]);

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

  async listPage(
    tenantId: string,
    options: { limit?: number; nextToken?: string } = {}
  ): Promise<{ outputs: VerificationOutput[]; nextToken?: string }> {
    const page = await this.table.queryPageByPrefix({
      pk: buildTenantPartitionKey(tenantId),
      skPrefix: 'VERIFY#',
      limit: options.limit,
      nextToken: options.nextToken,
      scanIndexForward: false,
      paginationContext: {
        tenantId,
        scope: 'verification:list',
      },
    });

    const outputs = page.items
      .map((item) => item.data as VerificationOutput)
      .sort(
        (left, right) =>
          new Date(right.recordedAt).getTime() -
          new Date(left.recordedAt).getTime()
      );

    return { outputs, nextToken: page.nextToken };
  }

  async list(tenantId: string): Promise<VerificationOutput[]> {
    const page = await this.listPage(tenantId, { limit: 100 });
    return page.outputs;
  }
}
