import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { prepareActionLogRecord } from '../../action-log/record-builder';
import { resolveLogicalActionLogEventId } from '../../action-log/event-identity';
import { ActionLogValidationError } from '../../action-log/types';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { ML_MODEL_CONTRACT_VERSION } from '../../ml-decision/model-version';
import { extractMlProvenance } from '../../provenance-reconstruction/ml-provenance';
import { DynamoDbActionLogRepository } from '../../repositories/dynamodb/dynamodb-action-log-repository';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { DecisionProvenanceReconstructionService } from '../../services/decision-provenance-reconstruction-service';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import { buildMlDecisionEvaluateInput } from '../fixtures/evidence/ml-fixtures';
import {
  SPRINT4_CORRELATION_ID,
  SPRINT4_DECISION_ID,
  seedActionLogEvents,
} from '../fixtures/sprint-4-provenance/provenance-fixtures';

const SECRET_PATTERN =
  /aws[_-]?access[_-]?key|aws[_-]?secret|secretaccesskey|sessiontoken|authorization|mfa|externalid|provider.?secret|akid/i;

describe('Sprint 4 ML model provenance qualification', () => {
  it('round-trips evaluationId, modelId, modelVersion, featureSchemaVersion, eligibilityPolicyVersion, timestamps, outcome, reasons, and fallback', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const reconstruction = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const evaluateInput = buildMlDecisionEvaluateInput({
      correlationId: SPRINT4_CORRELATION_ID,
    });
    const { decision } = await service.evaluate(evaluateInput);

    await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: SPRINT4_CORRELATION_ID,
      recommendationId: evaluateInput.recommendationId,
      decisionId: SPRINT4_DECISION_ID,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT4_CORRELATION_ID,
        recommendationId: evaluateInput.recommendationId,
      },
    });

    const result = await reconstruction.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
    });

    assert.ok(result.mlProvenance);
    assert.equal(result.mlProvenance?.evaluationId, decision.evaluationId);
    assert.equal(result.mlProvenance?.modelId, decision.modelId);
    assert.equal(result.mlProvenance?.modelVersion, decision.modelVersion);
    assert.equal(
      result.mlProvenance?.featureSchemaVersion,
      decision.featureSchemaVersion,
    );
    assert.equal(
      result.mlProvenance?.featureSchemaVersion,
      ML_MODEL_CONTRACT_VERSION,
    );
    assert.equal(
      result.mlProvenance?.eligibilityPolicyVersion,
      decision.eligibilityPolicyVersion,
    );
    assert.equal(result.mlProvenance?.outcome, decision.outcome);
    assert.equal(result.mlProvenance?.fallback, decision.fallback);
    assert.ok(result.mlProvenance?.evaluatedAt);
    assert.ok(result.mlProvenance?.inferredAt);
    assert.ok(result.mlProvenance?.reasonCodes.includes(decision.eligibility));
    assert.ok(
      !result.mlProvenance?.reasonCodes.some((code) =>
        code.startsWith('FEATURE_SCHEMA:'),
      ),
    );
  });

  it('persists featureSchemaVersion as structured metadata, not a reason code', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const evaluateInput = buildMlDecisionEvaluateInput();
    const { decision } = await service.evaluate(evaluateInput);

    const events = await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: evaluateInput.correlationId,
      recommendationId: evaluateInput.recommendationId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: evaluateInput.correlationId,
        recommendationId: evaluateInput.recommendationId,
      },
    });

    const outcome = events[1]?.event;
    assert.equal(outcome?.featureSchemaVersion, ML_MODEL_CONTRACT_VERSION);
    assert.ok(
      !outcome?.reasonCodes?.includes(ML_MODEL_CONTRACT_VERSION),
      'featureSchemaVersion must not be encoded in reasonCodes',
    );
  });

  it('rejects empty featureSchemaVersion when the structured field is present', () => {
    assert.throws(
      () =>
        prepareActionLogRecord({
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          correlationId: SPRINT4_CORRELATION_ID,
          eventType: 'ML_EXECUTED',
          sourceStage: 'ML',
          sourceRecordId: 'eval-empty-schema',
          occurredAt: '2026-08-22T12:00:00.000Z',
          featureSchemaVersion: '   ',
        }),
      ActionLogValidationError,
    );
  });

  it('remains backward compatible when legacy ActionLog rows omit featureSchemaVersion', async () => {
    const legacyOutcome = prepareActionLogRecord({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
      decisionId: SPRINT4_DECISION_ID,
      eventType: 'ML_EXECUTED',
      sourceStage: 'ML',
      sourceRecordId: 'ml-legacy-schema',
      sourceRecordVersion: 'mock-model-v1',
      occurredAt: '2026-08-20T10:05:00.000Z',
      reasonCodes: ['EXECUTED', 'NONE', 'ML_ELIGIBLE'],
    });

    assert.equal(legacyOutcome.featureSchemaVersion, undefined);

    const repository = new MockActionLogRepository();
    await seedActionLogEvents(repository, [legacyOutcome]);

    const result = await new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    ).reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });

    assert.equal(result.mlProvenance?.evaluationId, 'ml-legacy-schema');
    assert.equal(result.mlProvenance?.featureSchemaVersion, undefined);
  });

  it('does not change logical event identity when featureSchemaVersion is present', () => {
    const baseInput = {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: 'corr-ml-schema-identity',
      eventType: 'ML_EXECUTED' as const,
      sourceStage: 'ML' as const,
      sourceRecordId: 'eval-schema-identity',
      sourceRecordVersion: 'mock-model-v1',
      occurredAt: '2026-08-20T10:05:00.000Z',
      reasonCodes: ['EXECUTED', 'NONE'],
    };

    const withoutSchema = resolveLogicalActionLogEventId(baseInput);
    const withSchema = resolveLogicalActionLogEventId({
      ...baseInput,
      featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
    });

    assert.equal(withoutSchema, withSchema);
  });

  it('DynamoDB ActionLog serialization preserves featureSchemaVersion for reconstruction', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const client = {
      send: async (command: PutCommand | QueryCommand | GetCommand) => {
        if (command instanceof PutCommand) {
          const item = command.input.Item as Record<string, unknown>;
          store.set(`${String(item.pk)}#${String(item.sk)}`, item);
          return {};
        }
        if (command instanceof GetCommand) {
          return {
            Item: store.get(
              `${String(command.input.Key?.pk)}#${String(command.input.Key?.sk)}`,
            ),
          };
        }
        if (command instanceof QueryCommand) {
          const pk = String(command.input.ExpressionAttributeValues?.[':pk']);
          const prefix = String(
            command.input.ExpressionAttributeValues?.[':skPrefix'],
          );
          return {
            Items: [...store.values()].filter(
              (item) => item.pk === pk && String(item.sk).startsWith(prefix),
            ),
          };
        }
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    const repository = new DynamoDbActionLogRepository(
      client,
      'sisum-execution-plans-test',
    );
    const evaluateInput = buildMlDecisionEvaluateInput({
      correlationId: SPRINT4_CORRELATION_ID,
    });
    const { decision } = await new MlDecisionService(
      new MockMlInferenceAdapter({ confidence: 0.91 }),
    ).evaluate(evaluateInput);

    await new ActionLogEmitter(new ActionLogService(repository)).emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: SPRINT4_CORRELATION_ID,
      recommendationId: evaluateInput.recommendationId,
      decisionId: SPRINT4_DECISION_ID,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: SPRINT4_CORRELATION_ID,
        recommendationId: evaluateInput.recommendationId,
      },
    });

    const listed = await repository.listByCorrelation(TENANT_A, SPRINT4_CORRELATION_ID);
    const reconstructed = extractMlProvenance(listed.items);
    const storedItems = [...store.values()];

    assert.ok(
      storedItems.some((item) => item.featureSchemaVersion === ML_MODEL_CONTRACT_VERSION),
    );
    assert.ok(
      listed.items.some(
        (event) => event.featureSchemaVersion === ML_MODEL_CONTRACT_VERSION,
      ),
    );
    assert.equal(reconstructed?.featureSchemaVersion, ML_MODEL_CONTRACT_VERSION);
    assert.ok(
      !listed.items.some((event) =>
        event.reasonCodes?.includes(ML_MODEL_CONTRACT_VERSION),
      ),
    );
  });

  it('never persists AWS keys, session tokens, Authorization headers, MFA values, or provider secrets', async () => {
    const repository = new MockActionLogRepository();
    const emitter = new ActionLogEmitter(new ActionLogService(repository));
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const evaluateInput = buildMlDecisionEvaluateInput();
    const { decision } = await service.evaluate(evaluateInput);

    await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: evaluateInput.resourceId,
      findingKey: evaluateInput.findingKey,
      correlationId: evaluateInput.correlationId,
      recommendationId: evaluateInput.recommendationId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: evaluateInput.correlationId,
        recommendationId: evaluateInput.recommendationId,
      },
    });

    const persisted = JSON.stringify(
      await repository.listByCorrelation(TENANT_A, evaluateInput.correlationId),
    );
    assert.equal(SECRET_PATTERN.test(persisted), false);
    assert.equal(SECRET_PATTERN.test(JSON.stringify(decision)), false);
  });
});
