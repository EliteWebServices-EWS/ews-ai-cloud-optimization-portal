import { randomUUID } from 'node:crypto';

import { GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  evidenceObservationSortKey,
  evidenceObservationSortKeyPrefixForFinding,
  isConditionalCheckFailure,
  RepositoryConflictError,
} from '../../database';
import {
  assessPersistence,
} from '../../persistence-intelligence/persistence-state-machine';
import {
  buildLogicalObservationId,
} from '../../persistence-intelligence/observation-ordering';
import { normalizeObservationTimestampIso, parseObservationTimestamp } from '../../persistence-intelligence/timestamp-rules';
import type {
  EvidenceObservationRecord,
  RecordEvidenceObservationInput,
  RecordEvidenceObservationResult,
} from '../../persistence-intelligence/types';
import type {
  EvidenceObservationListQuery,
  EvidenceObservationRepository,
  FindRelevantPreviousObservationInput,
  GetEvidenceObservationByLogicalIdInput,
} from '../contracts/evidence-observation-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  decodeEvidenceObservationNextToken,
  encodeEvidenceObservationNextToken,
} from '../evidence-observation-pagination';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface EvidenceObservationItem extends EvidenceObservationRecord {
  pk: string;
  sk: string;
  entityType: 'EVIDENCE_OBSERVATION';
}

function toEvidenceObservationRecord(item: EvidenceObservationItem): EvidenceObservationRecord {
  return {
    observationId: item.observationId,
    logicalObservationId: item.logicalObservationId,
    tenantId: item.tenantId,
    accountId: item.accountId,
    region: item.region,
    service: item.service,
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    findingKey: item.findingKey,
    recommendationId: item.recommendationId,
    recommendationFingerprint: item.recommendationFingerprint,
    recommendedAction: item.recommendedAction,
    category: item.category,
    ruleId: item.ruleId,
    ruleVersion: item.ruleVersion,
    analysisRunId: item.analysisRunId,
    jobId: item.jobId,
    correlationId: item.correlationId,
    provenance: item.provenance,
    observationTimestamp: item.observationTimestamp,
    collectionTimestamp: item.collectionTimestamp,
    persistedAt: item.persistedAt,
    assessment: item.assessment,
    version: item.version,
  };
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
  const sk = evidenceObservationSortKey({
    findingKey: input.findingKey,
    observationTimestampIso,
    logicalObservationId,
  });
  return { pk, sk, logicalObservationId, observationTimestampIso };
}

export class DynamoDbEvidenceObservationRepository
  extends BaseDynamoDbRepository
  implements EvidenceObservationRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  async getObservationByLogicalId(
    input: GetEvidenceObservationByLogicalIdInput,
  ): Promise<EvidenceObservationRecord | null> {
    const { pk, sk } = buildObservationKey(input);
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const item = result.Item as EvidenceObservationItem | undefined;
    if (!item || item.entityType !== 'EVIDENCE_OBSERVATION') {
      return null;
    }
    if (item.tenantId !== input.tenantId) {
      return null;
    }
    return toEvidenceObservationRecord(item);
  }

  async findRelevantPreviousObservation(
    input: FindRelevantPreviousObservationInput,
  ): Promise<EvidenceObservationRecord | null> {
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const skPrefix = evidenceObservationSortKeyPrefixForFinding(input.findingKey);
    const currentMs = parseObservationTimestamp(input.beforeObservationTimestamp).epochMs;
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
          ExpressionAttributeValues: {
            ':pk': pk,
            ':skPrefix': skPrefix,
          },
          ScanIndexForward: false,
          Limit: normalizePageSize(100),
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const rawItem of result.Items ?? []) {
        if (
          typeof rawItem !== 'object' ||
          rawItem === null ||
          (rawItem as EvidenceObservationItem).entityType !== 'EVIDENCE_OBSERVATION'
        ) {
          continue;
        }
        const observation = toEvidenceObservationRecord(rawItem as EvidenceObservationItem);
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
    query: EvidenceObservationListQuery,
  ): Promise<PageResult<EvidenceObservationRecord>> {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const limit = normalizePageSize(query.limit);
    const exclusiveStartKey = decodeEvidenceObservationNextToken(query.nextToken, query);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': evidenceObservationSortKeyPrefixForFinding(query.findingKey),
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = (result.Items ?? [])
      .filter(
        (item): item is EvidenceObservationItem =>
          typeof item === 'object' &&
          item !== null &&
          (item as EvidenceObservationItem).entityType === 'EVIDENCE_OBSERVATION' &&
          (item as EvidenceObservationItem).tenantId === query.tenantId,
      )
      .map(toEvidenceObservationRecord);
    return {
      items,
      nextToken: encodeEvidenceObservationNextToken(query, result.LastEvaluatedKey),
    };
  }

  async recordObservation(
    input: RecordEvidenceObservationInput,
  ): Promise<RecordEvidenceObservationResult> {
    const observationTimestampIso = normalizeObservationTimestampIso(input.observationTimestamp);
    const collectionTimestamp = normalizeObservationTimestampIso(input.collectionTimestamp);
    const { pk, sk, logicalObservationId } = buildObservationKey({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      observationTimestamp: observationTimestampIso,
      analysisRunId: input.analysisRunId,
    });

    const existingResult = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const existing = existingResult.Item as EvidenceObservationItem | undefined;
    if (existing?.entityType === 'EVIDENCE_OBSERVATION') {
      return {
        observation: toEvidenceObservationRecord(existing),
        assessment: existing.assessment,
        created: false,
      };
    }

    const relevantPrevious = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: observationTimestampIso,
      excludeLogicalObservationId: logicalObservationId,
    });
    const assessment = assessPersistence({
      request: {
        ...input,
        observationTimestamp: observationTimestampIso,
        collectionTimestamp,
      },
      priorObservations: relevantPrevious ? [relevantPrevious] : [],
    });
    const persistedAt = new Date().toISOString();
    const item: EvidenceObservationItem = {
      observationId: randomUUID(),
      logicalObservationId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      service: input.service,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      findingKey: input.findingKey,
      recommendationId: input.recommendationId,
      recommendationFingerprint: assessment.recommendationFingerprint,
      recommendedAction: input.recommendedAction,
      category: input.category,
      ruleId: input.ruleId,
      ruleVersion: input.ruleVersion,
      analysisRunId: input.analysisRunId,
      jobId: input.jobId,
      correlationId: input.correlationId,
      provenance: input.provenance,
      observationTimestamp: observationTimestampIso,
      collectionTimestamp,
      persistedAt,
      assessment,
      version: 1,
      pk,
      sk,
      entityType: 'EVIDENCE_OBSERVATION',
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
          return { observation: raced, assessment: raced.assessment, created: false };
        }
        throw new RepositoryConflictError('Evidence observation write conflict.');
      }
      throw error;
    }

    return {
      observation: toEvidenceObservationRecord(item),
      assessment,
      created: true,
    };
  }
}
