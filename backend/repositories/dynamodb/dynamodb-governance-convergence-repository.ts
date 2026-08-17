import { randomUUID } from 'node:crypto';

import { GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  governanceConvergenceObservationSortKey,
  governanceConvergenceObservationSortKeyPrefixForFinding,
  governanceConvergenceResultSortKey,
  governanceConvergenceResultSortKeyPrefixForFinding,
  isConditionalCheckFailure,
  parseGovernanceConvergenceFindingKeyOwner,
  RepositoryConflictError,
} from '../../database';
import {
  assessGovernanceConvergence,
  buildMissingEvidenceAssessment,
} from '../../governance-convergence/governance-convergence-engine';
import { buildLogicalObservationId } from '../../governance-convergence/observation-ordering';
import {
  normalizeObservationTimestampIso,
  parseObservationTimestamp,
} from '../../governance-convergence/timestamp-rules';
import type {
  GovernanceConvergenceAssessment,
  GovernanceConvergenceResultRecord,
  GovernanceEvidenceObservationRecord,
  RecordGovernanceEvidenceObservationInput,
  RecordGovernanceEvidenceObservationResult,
} from '../../governance-convergence/types';
import type {
  FindRelevantPreviousGovernanceObservationInput,
  GetGovernanceConvergenceObservationByLogicalIdInput,
  GovernanceConvergenceListQuery,
  GovernanceConvergenceRepository,
  RecordGovernanceMissingEvidenceInput,
} from '../contracts/governance-convergence-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  decodeGovernanceConvergenceNextToken,
  encodeGovernanceConvergenceNextToken,
} from '../governance-convergence-pagination';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface ObservationItem extends GovernanceEvidenceObservationRecord {
  pk: string;
  sk: string;
  entityType: 'GOVERNANCE_CONVERGENCE_OBSERVATION';
}

interface ResultItem extends GovernanceConvergenceResultRecord {
  pk: string;
  sk: string;
  entityType: 'GOVERNANCE_CONVERGENCE_RESULT';
}

function toObservationRecord(item: ObservationItem): GovernanceEvidenceObservationRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

function toResultRecord(item: ResultItem): GovernanceConvergenceResultRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

function buildObservationKey(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  observationTimestamp: string;
  analysisRunId: string;
}): { pk: string; sk: string; logicalObservationId: string; observationTimestampIso: string } {
  const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
  const logicalObservationId = buildLogicalObservationId({
    tenantId: input.tenantId,
    accountId: input.accountId,
    findingKey: input.findingKey,
    analysisRunId: input.analysisRunId,
    observationTimestamp: observationTimestampIso,
  });
  const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
  const sk = governanceConvergenceObservationSortKey({
    findingKey: input.findingKey,
    observationTimestampIso,
    logicalObservationId,
  });
  return { pk, sk, logicalObservationId, observationTimestampIso };
}

/**
 * Mirrors DynamoDbEvidenceObservationRepository (Engineer 1's Sprint 1
 * pattern) — same shared cloud-resources table, same conditional-put
 * idempotency, same descending-query "relevant previous" lookup — split
 * across two entity types (observations, results) per the Task 3/Task 4
 * separation documented in governance-convergence/types.ts.
 */
export class DynamoDbGovernanceConvergenceRepository
  extends BaseDynamoDbRepository
  implements GovernanceConvergenceRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  async getObservationByLogicalId(
    input: GetGovernanceConvergenceObservationByLogicalIdInput,
  ): Promise<GovernanceEvidenceObservationRecord | null> {
    const { pk, sk } = buildObservationKey(input);
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk } }));
    const item = result.Item as ObservationItem | undefined;
    if (!item || item.entityType !== 'GOVERNANCE_CONVERGENCE_OBSERVATION') {
      return null;
    }
    if (item.tenantId !== input.tenantId) {
      return null;
    }
    return toObservationRecord(item);
  }

  async findRelevantPreviousObservation(
    input: FindRelevantPreviousGovernanceObservationInput,
  ): Promise<GovernanceEvidenceObservationRecord | null> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const skPrefix = governanceConvergenceObservationSortKeyPrefixForFinding(input.findingKey);
    const currentMs = parseObservationTimestamp(input.beforeObservationTimestamp).epochMs;
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
          ExpressionAttributeValues: { ':pk': pk, ':skPrefix': skPrefix },
          ScanIndexForward: false,
          Limit: normalizePageSize(100),
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const rawItem of result.Items ?? []) {
        if (
          typeof rawItem !== 'object' ||
          rawItem === null ||
          (rawItem as ObservationItem).entityType !== 'GOVERNANCE_CONVERGENCE_OBSERVATION'
        ) {
          continue;
        }
        const observation = toObservationRecord(rawItem as ObservationItem);
        if (observation.tenantId !== input.tenantId) {
          continue;
        }
        if (
          input.excludeLogicalObservationId &&
          observation.logicalObservationId === input.excludeLogicalObservationId
        ) {
          continue;
        }
        const observationMs = parseObservationTimestamp(observation.observationTimestamp).epochMs;
        if (observationMs < currentMs) {
          return observation;
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return null;
  }

  async listObservationsForFinding(
    query: GovernanceConvergenceListQuery,
  ): Promise<PageResult<GovernanceEvidenceObservationRecord>> {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const limit = normalizePageSize(query.limit);
    const exclusiveStartKey = decodeGovernanceConvergenceNextToken(query.nextToken, query);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': governanceConvergenceObservationSortKeyPrefixForFinding(query.findingKey),
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = (result.Items ?? [])
      .filter(
        (item): item is ObservationItem =>
          typeof item === 'object' &&
          item !== null &&
          (item as ObservationItem).entityType === 'GOVERNANCE_CONVERGENCE_OBSERVATION' &&
          (item as ObservationItem).tenantId === query.tenantId,
      )
      .map(toObservationRecord);
    return { items, nextToken: encodeGovernanceConvergenceNextToken(query, result.LastEvaluatedKey) };
  }

  async recordObservation(
    input: RecordGovernanceEvidenceObservationInput,
  ): Promise<RecordGovernanceEvidenceObservationResult> {
    const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
    const collectionTimestamp = normalizeObservationTimestampIso(input.collectionTimestamp);
    const { pk, sk, logicalObservationId } = buildObservationKey({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      observationTimestamp: observationTimestampIso,
      analysisRunId: input.analysisRunId,
    });

    const existingResult = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk } }));
    const existing = existingResult.Item as ObservationItem | undefined;
    if (existing?.entityType === 'GOVERNANCE_CONVERGENCE_OBSERVATION') {
      const observation = toObservationRecord(existing);
      const latestResult = await this.getLatestResult(input.tenantId, input.accountId, input.findingKey);
      const matchingResult =
        latestResult && latestResult.currentEvidenceId === observation.observationId ? latestResult : undefined;
      return { observation, result: matchingResult, created: false };
    }

    const relevantPrevious = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: observationTimestampIso,
      excludeLogicalObservationId: logicalObservationId,
    });

    const persistedAt = new Date().toISOString();
    const item: ObservationItem = {
      observationId: randomUUID(),
      logicalObservationId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      resourceType: 'INSTANCE',
      resourceId: input.resourceId,
      check: input.check,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
      observationTimestamp: observationTimestampIso,
      collectionTimestamp,
      persistedAt,
      evidence: input.evidence,
      version: 1,
      pk,
      sk,
      entityType: 'GOVERNANCE_CONVERGENCE_OBSERVATION',
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': 'pk' },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const raced = await this.getObservationByLogicalId({
          tenantId: input.tenantId,
          accountId: input.accountId,
          findingKey: input.findingKey,
          analysisRunId: input.analysisRunId,
          observationTimestamp: observationTimestampIso,
        });
        if (raced) {
          return { observation: raced, result: undefined, created: false };
        }
        throw new RepositoryConflictError('Governance evidence observation write conflict.');
      }
      throw error;
    }

    const observation = toObservationRecord(item);
    const assessment = assessGovernanceConvergence({
      currentEvidence: input.evidence,
      currentObservationId: observation.observationId,
      previousObservation: relevantPrevious,
      evaluatedAt: persistedAt,
    });

    let result: GovernanceConvergenceResultRecord | undefined;
    if (assessment) {
      result = await this.persistResult(input, assessment);
    }

    return { observation, result, created: true };
  }

  async recordMissingEvidence(
    input: RecordGovernanceMissingEvidenceInput,
  ): Promise<GovernanceConvergenceResultRecord | null> {
    const previous = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: input.evaluatedAt,
    });
    if (!previous) {
      return null;
    }

    const assessment = buildMissingEvidenceAssessment({
      previousObservation: previous,
      evaluatedAt: input.evaluatedAt,
    });

    return this.persistResult(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: previous.region,
        resourceId: previous.resourceId,
        check: previous.check,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
      },
      assessment,
    );
  }

  async getLatestResult(
    tenantId: string,
    accountId: string,
    findingKey: string,
  ): Promise<GovernanceConvergenceResultRecord | null> {
    const pk = cloudResourceAccountPartitionKey(tenantId, accountId);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': governanceConvergenceResultSortKeyPrefixForFinding(findingKey),
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    const item = result.Items?.[0] as ResultItem | undefined;
    if (!item || item.entityType !== 'GOVERNANCE_CONVERGENCE_RESULT' || item.tenantId !== tenantId) {
      return null;
    }
    return toResultRecord(item);
  }

  async listResultsForFinding(
    query: GovernanceConvergenceListQuery,
  ): Promise<PageResult<GovernanceConvergenceResultRecord>> {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const limit = normalizePageSize(query.limit);
    const exclusiveStartKey = decodeGovernanceConvergenceNextToken(query.nextToken, query);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': governanceConvergenceResultSortKeyPrefixForFinding(query.findingKey),
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = (result.Items ?? [])
      .filter(
        (item): item is ResultItem =>
          typeof item === 'object' &&
          item !== null &&
          (item as ResultItem).entityType === 'GOVERNANCE_CONVERGENCE_RESULT' &&
          (item as ResultItem).tenantId === query.tenantId,
      )
      .map(toResultRecord);
    return { items, nextToken: encodeGovernanceConvergenceNextToken(query, result.LastEvaluatedKey) };
  }

  async resolveOwnerTenantId(findingKey: string): Promise<string | undefined> {
    return parseGovernanceConvergenceFindingKeyOwner(findingKey);
  }

  private async persistResult(
    identity: {
      tenantId: string;
      accountId: string;
      region: string;
      resourceId: string;
      check: string;
      findingKey: string;
      analysisRunId: string;
    },
    assessment: GovernanceConvergenceAssessment,
  ): Promise<GovernanceConvergenceResultRecord> {
    const resultId = randomUUID();
    const persistedAt = new Date().toISOString();
    const pk = cloudResourceAccountPartitionKey(identity.tenantId, identity.accountId);
    const sk = governanceConvergenceResultSortKey({
      findingKey: identity.findingKey,
      evaluatedAtIso: normalizeObservationTimestampIso(assessment.evaluatedAt),
      resultId,
    });

    const item: ResultItem = {
      ...assessment,
      resultId,
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      region: identity.region,
      resourceType: 'INSTANCE',
      resourceId: identity.resourceId,
      check: identity.check,
      findingKey: identity.findingKey,
      analysisRunId: identity.analysisRunId,
      persistedAt,
      version: 1,
      pk,
      sk,
      entityType: 'GOVERNANCE_CONVERGENCE_RESULT',
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#pk)',
        ExpressionAttributeNames: { '#pk': 'pk' },
      }),
    );

    return toResultRecord(item);
  }
}
