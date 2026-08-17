import { randomUUID } from 'node:crypto';

import { GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  cloudResourceAccountPartitionKey,
  governanceConvergenceMissingResultSortKey,
  governanceConvergenceObservationResultSortKey,
  governanceConvergenceObservationSortKey,
  governanceConvergenceObservationSortKeyPrefixForFinding,
  governanceConvergenceLatestSortKey,
  GOVERNANCE_CONVERGENCE_LATEST_SK_PREFIX,
  governanceConvergenceResultSortKeyPrefixForFinding,
  isConditionalCheckFailure,
  parseGovernanceConvergenceFindingKeyOwner,
  RepositoryConflictError,
} from '../../database';
import {
  assessGovernanceConvergence,
  buildMissingEvidenceAssessment,
} from '../../governance-convergence/governance-convergence-engine';
import {
  buildMissingLogicalResultId,
  buildObservationBackedLogicalResultId,
} from '../../governance-convergence/governance-convergence-result-identity';
import { buildLogicalObservationId, latestObservedControlCandidateShouldAdvance } from '../../governance-convergence/observation-ordering';
import {
  normalizeObservationTimestampIso,
  parseObservationTimestamp,
} from '../../governance-convergence/timestamp-rules';
import type {
  GovernanceConvergenceAssessment,
  GovernanceConvergenceResultRecord,
  GovernanceEvidenceObservationRecord,
  GovernanceLatestObservedControlRecord,
  RecordGovernanceEvidenceObservationInput,
  RecordGovernanceEvidenceObservationResult,
  UpsertGovernanceLatestObservedControlInput,
} from '../../governance-convergence/types';
import type {
  FindRelevantPreviousGovernanceObservationInput,
  GetGovernanceConvergenceObservationByLogicalIdInput,
  GovernanceConvergenceListQuery,
  GovernanceConvergenceRepository,
  ListLatestObservedControlsQuery,
  RecordGovernanceMissingEvidenceInput,
} from '../contracts/governance-convergence-repository';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  decodeGovernanceConvergenceNextToken,
  decodeLatestObservedControlsNextToken,
  encodeGovernanceConvergenceNextToken,
  encodeLatestObservedControlsNextToken,
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

interface LatestObservedControlItem extends GovernanceLatestObservedControlRecord {
  pk: string;
  sk: string;
  entityType: 'GOVERNANCE_CONVERGENCE_LATEST';
}

function toObservationRecord(item: ObservationItem): GovernanceEvidenceObservationRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

function toResultRecord(item: ResultItem): GovernanceConvergenceResultRecord {
  const { pk: _pk, sk: _sk, entityType: _entityType, ...rest } = item;
  return rest;
}

function toLatestObservedControlRecord(
  item: LatestObservedControlItem,
): GovernanceLatestObservedControlRecord {
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

function buildObservationBackedResultKey(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  logicalObservationId: string;
  sourceObservationTimestamp: string;
  ruleVersion?: string;
}): { pk: string; sk: string; logicalResultId: string } {
  const sourceObservationTimestampIso = normalizeObservationTimestampIso(
    input.sourceObservationTimestamp,
  );
  const logicalResultId = buildObservationBackedLogicalResultId({
    tenantId: input.tenantId,
    accountId: input.accountId,
    findingKey: input.findingKey,
    logicalObservationId: input.logicalObservationId,
    ruleVersion: input.ruleVersion,
  });
  const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
  const sk = governanceConvergenceObservationResultSortKey({
    findingKey: input.findingKey,
    sourceObservationTimestampIso,
    logicalResultId,
  });
  return { pk, sk, logicalResultId };
}

function buildMissingResultKey(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  analysisRunId: string;
  ruleVersion?: string;
}): { pk: string; sk: string; logicalResultId: string } {
  const logicalResultId = buildMissingLogicalResultId({
    tenantId: input.tenantId,
    accountId: input.accountId,
    findingKey: input.findingKey,
    analysisRunId: input.analysisRunId,
    ruleVersion: input.ruleVersion,
  });
  const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
  const sk = governanceConvergenceMissingResultSortKey({
    findingKey: input.findingKey,
    analysisRunId: input.analysisRunId,
    logicalResultId,
  });
  return { pk, sk, logicalResultId };
}

export class DynamoDbGovernanceConvergenceRepository
  extends BaseDynamoDbRepository
  implements GovernanceConvergenceRepository
{
  constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  private async getResultByKey(
    pk: string,
    sk: string,
    tenantId: string,
  ): Promise<GovernanceConvergenceResultRecord | null> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const item = result.Item as ResultItem | undefined;
    if (!item || item.entityType !== 'GOVERNANCE_CONVERGENCE_RESULT' || item.tenantId !== tenantId) {
      return null;
    }
    return toResultRecord(item);
  }

  private async recoverResultForObservation(
    observation: GovernanceEvidenceObservationRecord,
    input: RecordGovernanceEvidenceObservationInput,
  ): Promise<GovernanceConvergenceResultRecord | undefined> {
    const { pk, sk } = buildObservationBackedResultKey({
      tenantId: observation.tenantId,
      accountId: observation.accountId,
      findingKey: observation.findingKey,
      logicalObservationId: observation.logicalObservationId,
      sourceObservationTimestamp: observation.observationTimestamp,
    });
    const existing = await this.getResultByKey(pk, sk, observation.tenantId);
    if (existing) {
      return existing;
    }

    const relevantPrevious = await this.findRelevantPreviousObservation({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      beforeObservationTimestamp: observation.observationTimestamp,
      excludeLogicalObservationId: observation.logicalObservationId,
    });

    const assessment = assessGovernanceConvergence({
      currentEvidence: input.evidence,
      currentObservationId: observation.observationId,
      previousObservation: relevantPrevious,
      evaluatedAt: observation.persistedAt,
    });
    if (!assessment) {
      return undefined;
    }

    return this.persistObservationBackedResult(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: input.region,
        resourceId: input.resourceId,
        check: input.check,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
        logicalObservationId: observation.logicalObservationId,
        sourceObservationTimestamp: observation.observationTimestamp,
      },
      assessment,
    );
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
        ScanIndexForward: true,
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

    const existingResult = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const existing = existingResult.Item as ObservationItem | undefined;
    if (existing?.entityType === 'GOVERNANCE_CONVERGENCE_OBSERVATION') {
      const observation = toObservationRecord(existing);
      const recovered = await this.recoverResultForObservation(observation, input);
      return { observation, result: recovered, created: false };
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
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
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
          const recovered = await this.recoverResultForObservation(raced, input);
          return { observation: raced, result: recovered, created: false };
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
      result = await this.persistObservationBackedResult(
        {
          tenantId: input.tenantId,
          accountId: input.accountId,
          region: input.region,
          resourceId: input.resourceId,
          check: input.check,
          findingKey: input.findingKey,
          analysisRunId: input.analysisRunId,
          logicalObservationId,
          sourceObservationTimestamp: observationTimestampIso,
        },
        assessment,
      );
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

    const { pk, sk, logicalResultId } = buildMissingResultKey({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      analysisRunId: input.analysisRunId,
    });

    const existing = await this.getResultByKey(pk, sk, input.tenantId);
    if (existing) {
      return existing;
    }

    const assessment = buildMissingEvidenceAssessment({
      previousObservation: previous,
      evaluatedAt: input.evaluatedAt,
    });

    return this.persistMissingResult(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: previous.region,
        resourceId: previous.resourceId,
        check: previous.check,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
        logicalResultId,
        pk,
        sk,
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
        ScanIndexForward: true,
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

  async upsertLatestObservedControl(
    input: UpsertGovernanceLatestObservedControlInput,
  ): Promise<GovernanceLatestObservedControlRecord> {
    const latestObservationTimestamp = normalizeObservationTimestampIso(input.latestObservationTimestamp);
    const pk = cloudResourceAccountPartitionKey(input.tenantId, input.accountId);
    const sk = governanceConvergenceLatestSortKey({
      region: input.region,
      resourceId: input.resourceId,
      check: input.check,
    });

    const existingResult = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const existing = existingResult.Item as LatestObservedControlItem | undefined;
    if (
      existing?.entityType === 'GOVERNANCE_CONVERGENCE_LATEST' &&
      existing.tenantId === input.tenantId &&
      !latestObservedControlCandidateShouldAdvance(
        {
          latestObservationTimestamp,
          latestLogicalObservationId: input.latestLogicalObservationId,
        },
        {
          latestObservationTimestamp: existing.latestObservationTimestamp,
          latestLogicalObservationId: existing.latestLogicalObservationId,
        },
      )
    ) {
      return toLatestObservedControlRecord(existing);
    }

    const item: LatestObservedControlItem = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      resourceId: input.resourceId,
      check: input.check,
      findingKey: input.findingKey,
      latestObservationId: input.latestObservationId,
      latestLogicalObservationId: input.latestLogicalObservationId,
      latestObservationTimestamp,
      latestAnalysisRunId: input.latestAnalysisRunId,
      latestRuleVersion: input.latestRuleVersion,
      resourceLifecycleStatus: input.resourceLifecycleStatus,
      updatedAt: new Date().toISOString(),
      version: existing?.version ? existing.version + 1 : 1,
      pk,
      sk,
      entityType: 'GOVERNANCE_CONVERGENCE_LATEST',
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression:
            'attribute_not_exists(latestObservationTimestamp) OR latestObservationTimestamp < :newTs OR (latestObservationTimestamp = :newTs AND latestLogicalObservationId < :newLogicalId)',
          ExpressionAttributeValues: {
            ':newTs': latestObservationTimestamp,
            ':newLogicalId': input.latestLogicalObservationId,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const raced = await this.client.send(
          new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
        );
        const racedItem = raced.Item as LatestObservedControlItem | undefined;
        if (racedItem?.entityType === 'GOVERNANCE_CONVERGENCE_LATEST') {
          return toLatestObservedControlRecord(racedItem);
        }
        throw new RepositoryConflictError('Governance latest checkpoint write conflict.');
      }
      throw error;
    }

    return toLatestObservedControlRecord(item);
  }

  async listLatestObservedControls(
    query: ListLatestObservedControlsQuery,
  ): Promise<PageResult<GovernanceLatestObservedControlRecord>> {
    if (query.regions.length === 0) {
      return { items: [] };
    }

    const pk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    const limit = normalizePageSize(query.limit);
    const exclusiveStartKey = decodeLatestObservedControlsNextToken(query.nextToken, query);
    const regionSet = new Set(query.regions);
    const regionPlaceholders = query.regions.map((_, index) => `:region${index}`);
    const regionValues = Object.fromEntries(
      query.regions.map((region, index) => [`:region${index}`, region]),
    );

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        FilterExpression: `#region IN (${regionPlaceholders.join(', ')})`,
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#region': 'region' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': GOVERNANCE_CONVERGENCE_LATEST_SK_PREFIX,
          ...regionValues,
        },
        ScanIndexForward: true,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (result.Items ?? [])
      .filter(
        (item): item is LatestObservedControlItem =>
          typeof item === 'object' &&
          item !== null &&
          (item as LatestObservedControlItem).entityType === 'GOVERNANCE_CONVERGENCE_LATEST' &&
          (item as LatestObservedControlItem).tenantId === query.tenantId &&
          regionSet.has((item as LatestObservedControlItem).region),
      )
      .map(toLatestObservedControlRecord);

    return {
      items,
      nextToken: encodeLatestObservedControlsNextToken(query, result.LastEvaluatedKey),
    };
  }

  private async persistObservationBackedResult(
    identity: {
      tenantId: string;
      accountId: string;
      region: string;
      resourceId: string;
      check: string;
      findingKey: string;
      analysisRunId: string;
      logicalObservationId: string;
      sourceObservationTimestamp: string;
    },
    assessment: GovernanceConvergenceAssessment,
  ): Promise<GovernanceConvergenceResultRecord> {
    const { pk, sk, logicalResultId } = buildObservationBackedResultKey({
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      findingKey: identity.findingKey,
      logicalObservationId: identity.logicalObservationId,
      sourceObservationTimestamp: identity.sourceObservationTimestamp,
      ruleVersion: assessment.ruleVersion,
    });

    const existing = await this.getResultByKey(pk, sk, identity.tenantId);
    if (existing) {
      return existing;
    }

    const persistedAt = new Date().toISOString();
    const item: ResultItem = {
      ...assessment,
      resultId: logicalResultId,
      currentLogicalObservationId: identity.logicalObservationId,
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
        const raced = await this.getResultByKey(pk, sk, identity.tenantId);
        if (raced) {
          return raced;
        }
        throw new RepositoryConflictError('Governance convergence result write conflict.');
      }
      throw error;
    }

    return toResultRecord(item);
  }

  private async persistMissingResult(
    identity: {
      tenantId: string;
      accountId: string;
      region: string;
      resourceId: string;
      check: string;
      findingKey: string;
      analysisRunId: string;
      logicalResultId: string;
      pk: string;
      sk: string;
    },
    assessment: GovernanceConvergenceAssessment,
  ): Promise<GovernanceConvergenceResultRecord> {
    const existing = await this.getResultByKey(identity.pk, identity.sk, identity.tenantId);
    if (existing) {
      return existing;
    }

    const persistedAt = new Date().toISOString();
    const item: ResultItem = {
      ...assessment,
      resultId: identity.logicalResultId,
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
      pk: identity.pk,
      sk: identity.sk,
      entityType: 'GOVERNANCE_CONVERGENCE_RESULT',
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
        const raced = await this.getResultByKey(identity.pk, identity.sk, identity.tenantId);
        if (raced) {
          return raced;
        }
        throw new RepositoryConflictError('Governance convergence result write conflict.');
      }
      throw error;
    }

    return toResultRecord(item);
  }
}
