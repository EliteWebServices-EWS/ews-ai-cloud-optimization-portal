import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DecisionReadinessService } from '../../decision-readiness/decision-readiness-service';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
  buildEc2FindingKeyForIdentity,
  buildEvidenceIdentity,
  buildGovernancePreservedContext,
  buildHighConfidenceMatureEvidenceInput,
  buildMatureStablePersistenceScenario,
  buildRecordEvidenceObservationInput,
  replayCostEvidencePipeline,
} from '../fixtures/evidence';

describe('Sprint 2 decision-readiness tenant and account isolation', () => {
  it('Tenant B cannot read Tenant A observation history via latest lookup', async () => {
    const repo = new MockEvidenceObservationRepository();
    const tenantAInput = buildRecordEvidenceObservationInput({ tenantId: TENANT_A });
    await repo.recordObservation(tenantAInput);
    const latestForB = await repo.getLatestObservationForFinding({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: tenantAInput.findingKey,
    });
    assert.equal(latestForB, null);
  });

  it('Tenant B cannot compose confidence evidence from Tenant A finding history', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: pipeline.lastInput.findingKey,
      recommendationCategory: pipeline.lastInput.category,
      recommendationId: pipeline.lastInput.recommendationId,
      recommendedAction: pipeline.lastInput.recommendedAction,
      resourceId: evidence.resourceId,
      evidence: evidence.evidence,
      validation: evidence.validation,
      evaluatedAt: pipeline.lastInput.observationTimestamp,
      governanceConvergence: buildGovernancePreservedContext(),
    });
    assert.equal(result.readiness, 'NOT_READY');
    assert.equal(result.persistence.sourceObservationId, '');
    assert.equal(result.maturity, undefined);
  });

  it('Account B history does not influence Account A readiness under same tenant', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const identityA = buildEvidenceIdentity({ tenantId: TENANT_A, accountId: ACCOUNT_A });
    const identityB = buildEvidenceIdentity({ tenantId: TENANT_A, accountId: ACCOUNT_B, resourceId: 'i-other-acct' });
    const findingKeyA = buildEc2FindingKeyForIdentity(identityA);
    const findingKeyB = buildEc2FindingKeyForIdentity(identityB);

    await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: {
        ...buildMatureStablePersistenceScenario(),
        inputs: buildMatureStablePersistenceScenario().inputs.map((input) => ({
          ...input,
          tenantId: TENANT_A,
          accountId: ACCOUNT_B,
          findingKey: findingKeyB,
        })),
      },
    });

    const pipelineA = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: {
        ...buildMatureStablePersistenceScenario(),
        inputs: buildMatureStablePersistenceScenario().inputs.map((input, index) => ({
          ...input,
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          findingKey: findingKeyA,
          analysisRunId: `run-a-${index + 1}`,
        })),
      },
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: findingKeyA,
      recommendationCategory: pipelineA.lastInput.category,
      recommendationId: pipelineA.lastInput.recommendationId,
      recommendedAction: pipelineA.lastInput.recommendedAction,
      resourceId: evidence.resourceId,
      evidence: evidence.evidence,
      validation: evidence.validation,
      evaluatedAt: pipelineA.lastInput.observationTimestamp,
      governanceConvergence: buildGovernancePreservedContext(),
      sourceObservationId: pipelineA.lastObservationId,
    });

    assert.equal(result.persistence.state, 'STABLE');
    assert.equal(result.readiness, 'READY');
    const accountBLatest = await observations.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_B,
      findingKey: findingKeyB,
    });
    assert.notEqual(accountBLatest?.findingKey, findingKeyA);
  });

  it('different finding keys do not share longitudinal history', async () => {
    const observations = new MockEvidenceObservationRepository();
    const identity = buildEvidenceIdentity();
    const findingKeyA = buildEc2FindingKeyForIdentity(identity);
    const findingKeyB = buildEc2FindingKeyForIdentity({ ...identity, resourceId: 'i-other-resource' });
    await observations.recordObservation(
      buildRecordEvidenceObservationInput({ findingKey: findingKeyA, analysisRunId: 'run-a' }),
    );
    await observations.recordObservation(
      buildRecordEvidenceObservationInput({ findingKey: findingKeyB, analysisRunId: 'run-b' }),
    );
    const latestA = await observations.getLatestObservationForFinding({
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      findingKey: findingKeyA,
    });
    const latestB = await observations.getLatestObservationForFinding({
      tenantId: identity.tenantId,
      accountId: identity.accountId,
      findingKey: findingKeyB,
    });
    assert.notEqual(latestA?.findingKey, latestB?.findingKey);
    assert.equal(latestA?.analysisRunId, 'run-a');
    assert.equal(latestB?.analysisRunId, 'run-b');
  });
});
