import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DecisionReadinessService } from '../../decision-readiness/decision-readiness-service';
import { DECISION_READINESS_REASON } from '../../decision-readiness/reason-codes';
import type { EvidenceObservationRepository } from '../../repositories/contracts/evidence-observation-repository';
import type {
  EvidenceObservationRecord,
} from '../../persistence-intelligence/types';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { DynamoDbEvidenceObservationRepository } from '../../repositories/dynamodb/dynamodb-evidence-observation-repository';
import { EvidenceMaturityService } from '../../services/evidence-maturity-service';
import {
  buildDuplicateObservationScenario,
  buildGovernancePreservedContext,
  buildGovernanceUnavailableContext,
  buildHighConfidenceMatureEvidenceInput,
  buildIncompleteEvidenceInput,
  buildMatureStablePersistenceScenario,
  buildNoDataEvidenceInput,
  buildOutOfOrderPersistenceScenario,
  buildRecordEvidenceObservationInput,
  replayCostEvidencePipeline,
  replayPersistenceScenario,
  TENANT_A,
  ACCOUNT_A,
} from '../fixtures/evidence';
import { buildAssessInputFromPipeline } from './sprint-2-decision-readiness-helpers';
import { createLinkedFakePersistenceTables } from '../unit/support/fake-persistence-table';
import type {
  GetLatestEvidenceObservationForFindingInput,
} from '../../repositories/contracts/evidence-observation-repository';

class TransientFailureObservationRepository
  extends MockEvidenceObservationRepository
  implements EvidenceObservationRepository
{
  override async getLatestObservationForFinding(
    _input: GetLatestEvidenceObservationForFindingInput,
  ): Promise<EvidenceObservationRecord | null> {
    throw new Error('DYNAMODB_TRANSIENT_FAILURE');
  }
}

describe('Sprint 2 decision-readiness failure and degradation matrix', () => {
  it('DynamoDB transient failure surfaces without fabricating readiness evidence', async () => {
    const observations = new TransientFailureObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const service = new DecisionReadinessService(observations, maturityRepo);

    await assert.rejects(
      () =>
        service.assess(
          buildAssessInputFromPipeline({
            pipeline,
            ...evidence,
            governanceConvergence: buildGovernancePreservedContext(),
          }),
        ),
      /DYNAMODB_TRANSIENT_FAILURE/,
    );
  });

  it('duplicate SQS delivery replays idempotently without inflating readiness history', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const scenario = buildDuplicateObservationScenario();
    const input = scenario.inputs[0]!;
    const firstDelivery = await observations.recordObservation(input);
    const duplicateDelivery = await observations.recordObservation(input);
    assert.equal(firstDelivery.created, true);
    assert.equal(duplicateDelivery.created, false);
    assert.equal(firstDelivery.observation.observationId, duplicateDelivery.observation.observationId);

    const maturity = new EvidenceMaturityService(maturityRepo, observations);
    const firstMaturity = await maturity.evaluateAndPersist({
      observation: firstDelivery.observation,
      evaluatedAt: input.observationTimestamp,
    });
    const replayMaturity = await maturity.evaluateAndPersist({
      observation: duplicateDelivery.observation,
      evaluatedAt: input.observationTimestamp,
    });
    assert.equal(firstMaturity.created, true);
    assert.equal(replayMaturity.created, false);

    const listed = await observations.listObservationsForFinding({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
    });
    assert.equal(listed.items.length, 1);

    const evidence = buildHighConfidenceMatureEvidenceInput();
    const service = new DecisionReadinessService(observations, maturityRepo);
    const assessInput = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      recommendationCategory: input.category,
      recommendationId: input.recommendationId,
      recommendedAction: input.recommendedAction,
      resourceId: evidence.resourceId,
      evidence: evidence.evidence,
      validation: evidence.validation,
      evaluatedAt: input.observationTimestamp,
      governanceConvergence: buildGovernancePreservedContext(),
      sourceObservationId: firstDelivery.observation.observationId,
    };
    const firstAssessment = await service.assess(assessInput);
    const replayAssessment = await service.assess(assessInput);
    assert.deepEqual(firstAssessment, replayAssessment);
    assert.equal(firstAssessment.readiness, 'NOT_READY');
  });

  it('missing prior observation does not fabricate STABLE or MATURE', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: {
        name: 'FIRST_SIGHTING',
        inputs: buildMatureStablePersistenceScenario().inputs.slice(0, 1),
        expectedStates: ['NEW'],
      },
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.persistence.state, 'NEW');
    assert.equal(result.maturity?.maturity, 'IMMATURE');
    assert.equal(result.readiness, 'NOT_READY');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.PERSISTENCE_NOT_STABLE));
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.MATURITY_NOT_MATURE));
  });

  it('CloudWatch NO_DATA degrades confidence and yields NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildNoDataEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.readiness, 'NOT_READY');
    assert.notEqual(result.confidence.status, 'HIGH');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.CONFIDENCE_NOT_HIGH));
  });

  it('CloudWatch partial data caps confidence and yields NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const partialEvidence = {
      ...evidence.evidence,
      metrics: {
        ...evidence.evidence.metrics,
        datapoints: 2,
        utilizationHistory: evidence.evidence.metrics.utilizationHistory.slice(0, 2),
      },
    };
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        evidence: partialEvidence,
        validation: evidence.validation,
        resourceId: evidence.resourceId,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.readiness, 'NOT_READY');
    assert.notEqual(result.confidence.status, 'HIGH');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.CONFIDENCE_NOT_HIGH));
  });

  it('governance evidence unavailable does not imply compliance', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernanceUnavailableContext(),
      }),
    );

    assert.equal(result.readiness, 'NOT_READY');
    assert.equal(result.governance.convergence.contextAvailable, false);
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.GOVERNANCE_CONTEXT_UNAVAILABLE));
  });

  it('maturity evaluation failure does not corrupt the original evidence observation', async () => {
    const observations = new MockEvidenceObservationRepository();
    class FailingMaturityRepository extends MockEvidenceMaturityRepository {
      override async recordAssessment(): Promise<never> {
        throw new Error('MATURITY_WRITE_FAILED');
      }
    }
    const maturityRepo = new FailingMaturityRepository();
    const maturity = new EvidenceMaturityService(maturityRepo, observations);
    await replayPersistenceScenario(observations, buildMatureStablePersistenceScenario());
    const listed = await observations.listObservationsForFinding({
      tenantId: buildMatureStablePersistenceScenario().inputs[0]!.tenantId,
      accountId: buildMatureStablePersistenceScenario().inputs[0]!.accountId,
      findingKey: buildMatureStablePersistenceScenario().inputs[0]!.findingKey,
    });
    const observation = listed.items[listed.items.length - 1]!;
    await assert.rejects(
      () =>
        maturity.evaluateAndPersist({
          observation,
          evaluatedAt: observation.observationTimestamp,
        }),
      /MATURITY_WRITE_FAILED/,
    );
    const after = await observations.listObservationsForFinding({
      tenantId: observation.tenantId,
      accountId: observation.accountId,
      findingKey: observation.findingKey,
    });
    assert.equal(after.items.length, listed.items.length);
    assert.equal(after.items.at(-1)?.observationId, observation.observationId);
  });

  it('confidence evaluation with incomplete evidence yields NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildIncompleteEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.readiness, 'NOT_READY');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.VALIDATION_INVALID));
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.CONFIDENCE_NOT_HIGH));
  });

  it('out-of-order observations preserve append-only semantics at assessment time', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const scenario = buildOutOfOrderPersistenceScenario();
    await replayPersistenceScenario(observations, scenario);
    for (const scenarioInput of scenario.inputs) {
      const listed = await observations.listObservationsForFinding({
        tenantId: scenarioInput.tenantId,
        accountId: scenarioInput.accountId,
        findingKey: scenarioInput.findingKey,
        limit: 100,
      });
      const observation = listed.items.find(
        (item) =>
          item.analysisRunId === scenarioInput.analysisRunId &&
          item.observationTimestamp === scenarioInput.observationTimestamp,
      );
      if (observation) {
        await new EvidenceMaturityService(maturityRepo, observations).evaluateAndPersist({
          observation,
          evaluatedAt: scenarioInput.observationTimestamp,
        });
      }
    }

    const latest = await observations.getLatestObservationForFinding({
      tenantId: scenario.inputs[0]!.tenantId,
      accountId: scenario.inputs[0]!.accountId,
      findingKey: scenario.inputs[0]!.findingKey,
    });
    assert.equal(latest?.analysisRunId, 'run-order-c');

    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess({
      tenantId: latest!.tenantId,
      accountId: latest!.accountId,
      findingKey: latest!.findingKey,
      recommendationCategory: latest!.category,
      recommendationId: latest!.recommendationId,
      recommendedAction: latest!.recommendedAction,
      resourceId: evidence.resourceId,
      evidence: evidence.evidence,
      validation: evidence.validation,
      evaluatedAt: latest!.observationTimestamp,
      governanceConvergence: buildGovernancePreservedContext(),
      sourceObservationId: latest!.observationId,
    });

    assert.equal(result.persistence.state, 'STABLE');
    const history = await observations.listObservationsForFinding({
      tenantId: latest!.tenantId,
      accountId: latest!.accountId,
      findingKey: latest!.findingKey,
    });
    assert.equal(history.items.length, 3);
    assert.equal(result.persistence.sourceObservationId, latest!.observationId);
    assert.equal(latest!.analysisRunId, 'run-order-c');
    assert.equal(result.persistence.state, 'STABLE');
  });
});

describe('DynamoDB bounded latest lookup query shape', () => {
  it('uses Query with ScanIndexForward false and Limit 1', async () => {
    const queries: QueryCommand[] = [];
    const { client: baseClient } = createLinkedFakePersistenceTables();
    const client = {
      send: async (command: unknown) => {
        if (command instanceof QueryCommand) {
          queries.push(command);
        }
        return baseClient.send(command);
      },
    };
    const repo = new DynamoDbEvidenceObservationRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    const input = buildRecordEvidenceObservationInput({ analysisRunId: 'run-query-shape' });
    await repo.recordObservation(input);
    await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: input.findingKey,
    });

    const latestQuery = queries.find((query) => query.input.Limit === 1);
    assert.ok(latestQuery);
    assert.equal(latestQuery.input.ScanIndexForward, false);
    assert.match(String(latestQuery.input.KeyConditionExpression), /begins_with/);
  });
});
