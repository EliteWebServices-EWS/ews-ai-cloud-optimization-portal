import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  EXECUTION_PLAN_SK_PREFIX,
  executionPlanSortKey,
  executionStatusIndexPartitionKey,
  executionStatusIndexSortKey,
  executionWorkflowIndexPartitionKey,
  executionWorkflowIndexSortKey,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  isConditionalCheckFailure,
  tenantPartitionKey,
} from '../../database';

import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { EXECUTION_PAGINATION_SCOPES } from '../../persistence/execution-pagination-scopes';

import type {
  CreateExecutionPlanInput,
  ExecutionApprovalDecisionInput,
  ExecutionPlanRepository,
  PageRequest,
  PageResult,
  UpdateExecutionPlanInput,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type {
  ExecutionPlanRecord,
  ExecutionPlanStatus,
} from '../models';

import {
  validateExecutionPlanShape,
} from '../models/execution-persistence-models';

import {
  approvalFieldsForDecision,
  validateExecutionStartAllowed,
  validateExecutionTransition,
} from '../../services/execution-lifecycle';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface ExecutionPlanItem extends ExecutionPlanRecord {
  pk: string;
  sk: string;
  entityType: 'EXECUTION_PLAN';
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

function toExecutionPlanRecord(item: ExecutionPlanItem): ExecutionPlanRecord {
  return {
    tenantId: item.tenantId,
    executionId: item.executionId,
    workflowId: item.workflowId,
    recommendationId: item.recommendationId,
    planStatus: item.planStatus,
    createdBy: item.createdBy,
    executionSteps: item.executionSteps,
    rollbackPlan: item.rollbackPlan,
    riskLevel: item.riskLevel,
    approvalRequired: item.approvalRequired,
    approvalStatus: item.approvalStatus,
    approvedBy: item.approvedBy,
    approvedAt: item.approvedAt,
    rejectedBy: item.rejectedBy,
    rejectedAt: item.rejectedAt,
    rejectionReason: item.rejectionReason,
    metadata: item.metadata,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function buildGsiKeys(record: ExecutionPlanRecord): Pick<
  ExecutionPlanItem,
  'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'
> {
  return {
    gsi1pk: executionWorkflowIndexPartitionKey(
      record.tenantId,
      record.workflowId,
    ),
    gsi1sk: executionWorkflowIndexSortKey(
      record.createdAt,
      record.executionId,
    ),
    gsi2pk: executionStatusIndexPartitionKey(
      record.tenantId,
      record.planStatus,
    ),
    gsi2sk: executionStatusIndexSortKey(
      record.createdAt,
      record.executionId,
    ),
  };
}

export class DynamoDbExecutionPlanRepository
  extends BaseDynamoDbRepository
  implements ExecutionPlanRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateExecutionPlanInput,
  ): Promise<ExecutionPlanRecord> {
    validateExecutionPlanShape(input);

    const now = new Date().toISOString();
    const record: ExecutionPlanRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: ExecutionPlanItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: executionPlanSortKey(record.executionId),
      entityType: 'EXECUTION_PLAN',
      ...buildGsiKeys(record),
      ...record,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression:
            'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryAlreadyExistsError(
          `Execution plan ${record.executionId} already exists for tenant ${record.tenantId}.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async getById(
    tenantId: string,
    executionId: string,
  ): Promise<ExecutionPlanRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: executionPlanSortKey(executionId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toExecutionPlanRecord(result.Item as ExecutionPlanItem);
  }

  public async update(
    tenantId: string,
    executionId: string,
    changes: UpdateExecutionPlanInput,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord> {
    const existing = await this.getById(tenantId, executionId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution plan ${executionId} was not found.`,
      );
    }

    const merged: ExecutionPlanRecord = {
      ...existing,
      ...changes,
      tenantId: existing.tenantId,
      executionId: existing.executionId,
      workflowId: existing.workflowId,
      recommendationId: existing.recommendationId,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
    };

    validateExecutionPlanShape(merged);
    validateExecutionStartAllowed(
      merged.planStatus,
      merged.approvalRequired,
      merged.approvalStatus,
    );

    const storageChanges: Record<string, unknown> = { ...changes };

    if (changes.planStatus !== undefined) {
      storageChanges.gsi2pk = executionStatusIndexPartitionKey(
        tenantId,
        changes.planStatus,
      );
    }

    const expression = this.buildVersionedUpdateExpression(
      storageChanges,
      options.expectedVersion,
    );

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: executionPlanSortKey(executionId),
          },
          UpdateExpression: expression.updateExpression,
          ConditionExpression:
            'attribute_exists(pk) AND #version = :expectedVersion',
          ExpressionAttributeNames: expression.expressionAttributeNames,
          ExpressionAttributeValues: expression.expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new RepositoryNotFoundError(
          `Execution plan ${executionId} was not found.`,
        );
      }

      return toExecutionPlanRecord(
        result.Attributes as ExecutionPlanItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Execution plan ${executionId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async transitionStatus(
    tenantId: string,
    executionId: string,
    nextStatus: ExecutionPlanStatus,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord> {
    const existing = await this.getById(tenantId, executionId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution plan ${executionId} was not found.`,
      );
    }

    validateExecutionTransition(existing.planStatus, nextStatus, {
      approvalRequired: existing.approvalRequired,
      approvalStatus: existing.approvalStatus,
    });

    const mergedStatus = nextStatus;
    validateExecutionStartAllowed(
      mergedStatus,
      existing.approvalRequired,
      existing.approvalStatus,
    );

    return this.update(
      tenantId,
      executionId,
      { planStatus: nextStatus },
      options,
    );
  }

  public async recordApprovalDecision(
    tenantId: string,
    executionId: string,
    decision: ExecutionApprovalDecisionInput,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord> {
    const existing = await this.getById(tenantId, executionId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution plan ${executionId} was not found.`,
      );
    }

    if (!existing.approvalRequired) {
      throw new RepositoryConflictError(
        `Execution plan ${executionId} does not require approval.`,
      );
    }

    if (existing.planStatus !== 'PENDING_APPROVAL') {
      throw new RepositoryConflictError(
        `Execution plan ${executionId} is not awaiting approval.`,
      );
    }

    const decidedAt = decision.decidedAt ?? new Date().toISOString();
    const approvalChanges = approvalFieldsForDecision({
      decision: decision.decision,
      actorId: decision.actorId,
      decidedAt,
      rejectionReason: decision.rejectionReason,
    });

    if (decision.decision === 'APPROVED') {
      validateExecutionTransition(
        existing.planStatus,
        'APPROVED',
        {
          approvalRequired: true,
          approvalStatus: existing.approvalStatus,
        },
      );
    } else {
      validateExecutionTransition(
        existing.planStatus,
        'REJECTED',
        {
          approvalRequired: true,
          approvalStatus: existing.approvalStatus,
        },
      );
    }

    return this.update(
      tenantId,
      executionId,
      approvalChanges,
      options,
    );
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.tenantList(tenantId);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :executionPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':executionPrefix': EXECUTION_PLAN_SK_PREFIX,
        },
        ExclusiveStartKey: decodeScopedNextToken(page?.nextToken, {
          tenantId,
          scope,
        }),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toExecutionPlanRecord(item as ExecutionPlanItem),
    );

    return {
      items,
      nextToken: encodeScopedNextToken(
        { tenantId, scope },
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.workflowList(
      tenantId,
      workflowId,
    );

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: {
          '#gsi1pk': 'gsi1pk',
        },
        ExpressionAttributeValues: {
          ':gsi1pk': executionWorkflowIndexPartitionKey(
            tenantId,
            workflowId,
          ),
        },
        ExclusiveStartKey: decodeScopedNextToken(page?.nextToken, {
          tenantId,
          scope,
        }),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toExecutionPlanRecord(item as ExecutionPlanItem),
    );

    return {
      items,
      nextToken: encodeScopedNextToken(
        { tenantId, scope },
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listByStatus(
    tenantId: string,
    status: ExecutionPlanStatus,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.statusList(tenantId, status);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi2',
        KeyConditionExpression: '#gsi2pk = :gsi2pk',
        ExpressionAttributeNames: {
          '#gsi2pk': 'gsi2pk',
        },
        ExpressionAttributeValues: {
          ':gsi2pk': executionStatusIndexPartitionKey(tenantId, status),
        },
        ExclusiveStartKey: decodeScopedNextToken(page?.nextToken, {
          tenantId,
          scope,
        }),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toExecutionPlanRecord(item as ExecutionPlanItem),
    );

    return {
      items,
      nextToken: encodeScopedNextToken(
        { tenantId, scope },
        result.LastEvaluatedKey,
      ),
    };
  }
}
