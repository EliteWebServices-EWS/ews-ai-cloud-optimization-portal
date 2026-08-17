import { randomUUID } from 'node:crypto';

import { GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  evidenceMaturityAssessmentSortKey,
  evidenceMaturityAssessmentSortKeyPrefixForFinding,
  isConditionalCheckFailure,
  RepositoryConflictError,
} from '../../database';
import { normalizeObservationTimestampIso } from '../../persistence-intelligence/timestamp-rules';
import type {
  EvidenceMaturityAssessment,
  EvidenceMaturityAssessmentRecord,
  RecordEvidenceMaturityAssessmentResult,
} from '../../evidence-maturity/types';
import type {
  EvidenceMaturityAssessmentListQuery,
  EvidenceMaturityRepository,
  GetEvidenceMaturityAssessmentInput,
} from '../contracts/evidence-maturity-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  decodeEvidenceMaturityNextToken,
  encodeEvidenceMaturityNextToken,
} from '../evidence-maturity-pagination';
import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface EvidenceMaturityAssessmentItem extends EvidenceMaturityAssessmentRecord {
  pk: string;
  sk: string;
  entityType: 'EVIDENCE_MATURITY_ASSESSMENT';
}

function toEvidenceMaturityAssessmentRecord(
  item: EvidenceMaturityAssessmentItem,
): EvidenceMaturityAssessmentRecord {
  return {
    assessmentId: item.assessmentId,
    persistedAt: item.persistedAt,
    maturity: item.maturity,
    score: item.score,
    reasonCodes: item.reasonCodes,
    observationCount: item.observationCount,
    stableEpochObservationCount:
      item.stableEpochObservationCount ?? item.observationCount,
    persistenceHours: item.persistenceHours,
    stableEpochHours: item.stableEpochHours,
    evidenceCompleteness: item.evidenceCompleteness,
    telemetryApplicability: item.telemetryApplicability,
    evaluatedAt: item.evaluatedAt,
    sourceObservationTimestamp: item.sourceObservationTimestamp,
    modelVersion: item.modelVersion,
    sourceObservationId: item.sourceObservationId,
    sourceLogicalObservationId: item.sourceLogicalObservationId,
    sourcePersistenceState: item.sourcePersistenceState,
    tenantId: item.tenantId,
    accountId: item.accountId,
    region: item.region,
    resourceId: item.resourceId,
    findingKey: item.findingKey,
    recommendationFingerprint: item.recommendationFingerprint,
    ruleId: item.ruleId,
    ruleVersion: item.ruleVersion,
    category: item.category,
    analysisRunId: item.analysisRunId,
    stableEpochObservationIds: item.stableEpochObservationIds,
    stableEpochLogicalObservationIds: item.stableEpochLogicalObservationIds,
    scoreFactors: item.scoreFactors,
  };
}

function buildAssessmentKey(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  sourceObservationTimestamp: string;
  sourceLogicalObservationId: string;
  modelVersion: string;
}): { pk: string; sk: string } {
  const sourceObservationTimestampIso = normalizeObservationTimestampIso(
    input.sourceObservationTimestamp,
  );
  const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
  const sk = evidenceMaturityAssessmentSortKey({
    findingKey: input.findingKey,
    sourceObservationTimestampIso,
    sourceLogicalObservationId: input.sourceLogicalObservationId,
    modelVersion: input.modelVersion,
  });
  return { pk, sk };
}

export class DynamoDbEvidenceMaturityRepository
  extends BaseDynamoDbRepository
  implements EvidenceMaturityRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  private async getAssessmentByDeterministicKey(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
    sourceObservationTimestamp: string;
    sourceLogicalObservationId: string;
    modelVersion: string;
  }): Promise<EvidenceMaturityAssessmentRecord | null> {
    const { pk, sk } = buildAssessmentKey(input);
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const item = result.Item as EvidenceMaturityAssessmentItem | undefined;
    if (!item || item.entityType !== 'EVIDENCE_MATURITY_ASSESSMENT') {
      return null;
    }
    if (item.tenantId !== input.tenantId) {
      return null;
    }
    return toEvidenceMaturityAssessmentRecord(item);
  }

  async getAssessmentByLogicalKey(
    input: GetEvidenceMaturityAssessmentInput,
  ): Promise<EvidenceMaturityAssessmentRecord | null> {
    if (!input.sourceObservationTimestamp) {
      return null;
    }
    return this.getAssessmentByDeterministicKey({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      sourceObservationTimestamp: input.sourceObservationTimestamp,
      sourceLogicalObservationId: input.sourceLogicalObservationId,
      modelVersion: input.modelVersion,
    });
  }

  async listAssessmentsForFinding(
    query: EvidenceMaturityAssessmentListQuery,
  ): Promise<PageResult<EvidenceMaturityAssessmentRecord>> {
    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const limit = normalizePageSize(query.limit);
    const exclusiveStartKey = decodeEvidenceMaturityNextToken(query.nextToken, query);
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': evidenceMaturityAssessmentSortKeyPrefixForFinding(query.findingKey),
        },
        ScanIndexForward: true,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = (result.Items ?? [])
      .filter(
        (item): item is EvidenceMaturityAssessmentItem =>
          typeof item === 'object' &&
          item !== null &&
          (item as EvidenceMaturityAssessmentItem).entityType === 'EVIDENCE_MATURITY_ASSESSMENT' &&
          (item as EvidenceMaturityAssessmentItem).tenantId === query.tenantId,
      )
      .map(toEvidenceMaturityAssessmentRecord);
    return {
      items,
      nextToken: encodeEvidenceMaturityNextToken(query, result.LastEvaluatedKey),
    };
  }

  async recordAssessment(
    assessment: EvidenceMaturityAssessment,
  ): Promise<RecordEvidenceMaturityAssessmentResult> {
    const keyInput = {
      tenantId: assessment.tenantId,
      accountId: assessment.accountId,
      findingKey: assessment.findingKey,
      sourceObservationTimestamp: assessment.sourceObservationTimestamp,
      sourceLogicalObservationId: assessment.sourceLogicalObservationId,
      modelVersion: assessment.modelVersion,
    };
    const { pk, sk } = buildAssessmentKey(keyInput);

    const existing = await this.getAssessmentByDeterministicKey(keyInput);
    if (existing) {
      return { record: existing, created: false };
    }

    const persistedAt = new Date().toISOString();
    const item: EvidenceMaturityAssessmentItem = {
      ...assessment,
      assessmentId: randomUUID(),
      persistedAt,
      pk,
      sk,
      entityType: 'EVIDENCE_MATURITY_ASSESSMENT',
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const raced = await this.getAssessmentByDeterministicKey(keyInput);
        if (raced) {
          return { record: raced, created: false };
        }
        throw new RepositoryConflictError('Evidence maturity assessment write conflict.');
      }
      throw error;
    }

    return { record: toEvidenceMaturityAssessmentRecord(item), created: true };
  }
}
