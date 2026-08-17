import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EVIDENCE_MATURITY_V1_CONFIG,
  EvidenceMaturityEvaluationError,
  computeCurrentStableEpoch,
  evaluateEvidenceMaturity,
  computeMaturityScore,
} from '../../evidence-maturity';
import { EvidenceMaturityService } from '../../services/evidence-maturity-service';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import {
  FIXED_OBSERVATION_TS_1,
  FIXED_OBSERVATION_TS_2,
  FIXED_OBSERVATION_TS_3,
} from '../fixtures/evidence/identities';
import {
  buildChangedRecommendationScenario,
  buildManyHistoricalObservations,
  buildPersistentRecommendationScenario,
  buildRecordEvidenceObservationInput,
  replayPersistenceScenario,
} from '../fixtures/evidence';

const EVALUATED_AT = '2026-08-12T12:10:00.000Z';

function evaluateCurrent(
  history: Awaited<ReturnType<MockEvidenceObservationRepository['recordObservation']>>['observation'][],
  input: {
    telemetryApplicability: 'REQUIRED' | 'NOT_APPLICABLE';
    dataCompleteness: 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'NO_DATA' | 'NOT_APPLICABLE';
  },
) {
  const source = history[history.length - 1]!;
  return evaluateEvidenceMaturity({
    sourceObservation: source,
    findingHistory: history,
    telemetryApplicability: input.telemetryApplicability,
    dataCompleteness: input.dataCompleteness,
    evaluatedAt: EVALUATED_AT,
    config: EVIDENCE_MATURITY_V1_CONFIG,
  });
}

async function replayAndCollect(
  repo: MockEvidenceObservationRepository,
  scenario: ReturnType<typeof buildPersistentRecommendationScenario>,
) {
  await replayPersistenceScenario(repo, scenario);
  const last = scenario.inputs[scenario.inputs.length - 1]!;
  const all: Awaited<ReturnType<MockEvidenceObservationRepository['recordObservation']>>['observation'][] = [];
  let nextToken: string | undefined;
  do {
    const page = await repo.listObservationsForFinding({
      tenantId: last.tenantId,
      accountId: last.accountId,
      findingKey: last.findingKey,
      limit: 100,
      nextToken,
    });
    all.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  return all.sort((a, b) => a.observationTimestamp.localeCompare(b.observationTimestamp));
}

describe('evidence maturity evaluator', () => {
  it('NEW → IMMATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const recorded = await repo.recordObservation(
      buildRecordEvidenceObservationInput({ analysisRunId: 'run-new' }),
    );
    const result = evaluateEvidenceMaturity({
      sourceObservation: recorded.observation,
      findingHistory: [recorded.observation],
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(result.maturity, 'IMMATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_FIRST_OBSERVATION'));
  });

  it('MISSING_PREVIOUS → IMMATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const input = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-missing',
      expectedPriorHistory: true,
    });
    const recorded = await repo.recordObservation(input);
    const result = evaluateEvidenceMaturity({
      sourceObservation: recorded.observation,
      findingHistory: [recorded.observation],
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(result.maturity, 'IMMATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_PRIOR_HISTORY_MISSING'));
  });

  it('CHANGED → IMMATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, buildChangedRecommendationScenario());
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
    });
    assert.equal(result.maturity, 'IMMATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_FINGERPRINT_CHANGED_RESET'));
  });

  it('stable epoch A,A → count 2', async () => {
    const repo = new MockEvidenceObservationRepository();
    const scenario = buildPersistentRecommendationScenario();
    await replayPersistenceScenario(repo, {
      ...scenario,
      inputs: scenario.inputs.slice(0, 2),
      expectedStates: ['NEW', 'STABLE'],
    });
    const history = await replayAndCollect(repo, {
      ...scenario,
      inputs: scenario.inputs.slice(0, 2),
      expectedStates: ['NEW', 'STABLE'],
    });
    const epoch = computeCurrentStableEpoch({
      sourceObservation: history[1]!,
      findingHistory: history,
    });
    assert.equal(epoch.observationCount, 2);
  });

  it('stable epoch A,A,B → count 1', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, buildChangedRecommendationScenario());
    const epoch = computeCurrentStableEpoch({
      sourceObservation: history[1]!,
      findingHistory: history,
    });
    assert.equal(epoch.observationCount, 1);
  });

  it('stable epoch A,A,B,B → count 2', async () => {
    const repo = new MockEvidenceObservationRepository();
    const changed = buildChangedRecommendationScenario();
    const stableAgain = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-changed-3',
      observationTimestamp: FIXED_OBSERVATION_TS_3,
      recommendedAction: 'Stop instance',
      fingerprintInput: changed.inputs[1]!.fingerprintInput,
      recommendationVersion: 3,
    });
    await replayPersistenceScenario(repo, changed);
    await repo.recordObservation(stableAgain);
    const history = await replayAndCollect(repo, {
      ...changed,
      inputs: [...changed.inputs, stableAgain],
      expectedStates: ['NEW', 'CHANGED', 'STABLE'],
    });
    const epoch = computeCurrentStableEpoch({
      sourceObservation: history[2]!,
      findingHistory: history,
    });
    assert.equal(epoch.observationCount, 2);
  });

  it('stable epoch A,A,B,B,B → count 3', async () => {
    const repo = new MockEvidenceObservationRepository();
    const changed = buildChangedRecommendationScenario();
    const fp = changed.inputs[1]!.fingerprintInput;
    const third = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-changed-3',
      observationTimestamp: FIXED_OBSERVATION_TS_3,
      recommendedAction: 'Stop instance',
      fingerprintInput: fp,
      recommendationVersion: 3,
    });
    const fourthTs = new Date(Date.parse(FIXED_OBSERVATION_TS_3) + 24 * 60 * 60 * 1000).toISOString();
    const fourth = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-changed-4',
      observationTimestamp: fourthTs,
      recommendedAction: 'Stop instance',
      fingerprintInput: fp,
      recommendationVersion: 4,
    });
    await replayPersistenceScenario(repo, changed);
    await repo.recordObservation(third);
    await repo.recordObservation(fourth);
    const history = await replayAndCollect(repo, {
      name: 'changed-stable',
      inputs: [...changed.inputs, third, fourth],
      expectedStates: ['NEW', 'CHANGED', 'STABLE', 'STABLE'],
    });
    const epoch = computeCurrentStableEpoch({
      sourceObservation: history[history.length - 1]!,
      findingHistory: history,
    });
    assert.equal(epoch.observationCount, 3);
  });

  it('2 STABLE observations + positive duration + COMPLETE telemetry → PARTIAL', async () => {
    const repo = new MockEvidenceObservationRepository();
    const scenario = buildPersistentRecommendationScenario();
    const history = await replayAndCollect(repo, {
      ...scenario,
      inputs: scenario.inputs.slice(0, 2),
      expectedStates: ['NEW', 'STABLE'],
    });
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
    });
    assert.equal(result.maturity, 'PARTIAL');
    assert.ok(result.reasonCodes.includes('MATURITY_STABLE_HISTORY_SUPPORTS_PARTIAL'));
  });

  it('3+ observations + stable epoch < 24h → PARTIAL', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = buildRecordEvidenceObservationInput({ analysisRunId: 'run-fast-1' });
    const ts2 = new Date(Date.parse(base.observationTimestamp) + 60 * 60 * 1000).toISOString();
    const ts3 = new Date(Date.parse(base.observationTimestamp) + 2 * 60 * 60 * 1000).toISOString();
    const history = await replayAndCollect(repo, {
      name: 'fast-stable',
      inputs: [
        base,
        buildRecordEvidenceObservationInput({
          analysisRunId: 'run-fast-2',
          observationTimestamp: ts2,
          recommendationVersion: 2,
        }),
        buildRecordEvidenceObservationInput({
          analysisRunId: 'run-fast-3',
          observationTimestamp: ts3,
          recommendationVersion: 3,
        }),
      ],
      expectedStates: ['NEW', 'STABLE', 'STABLE'],
    });
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
    });
    assert.equal(result.maturity, 'PARTIAL');
    assert.ok(result.stableEpochHours < 24);
  });

  it('otherwise mature history + PARTIAL telemetry → PARTIAL', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, buildPersistentRecommendationScenario());
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'PARTIAL',
    });
    assert.equal(result.maturity, 'PARTIAL');
    assert.ok(result.reasonCodes.includes('MATURITY_TELEMETRY_PARTIAL'));
  });

  it('STABLE + >=3 epoch obs + >=24h + COMPLETE → MATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, buildPersistentRecommendationScenario());
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
    });
    assert.equal(result.maturity, 'MATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_STABLE_HISTORY_SUPPORTS_MATURE'));
    assert.ok(result.reasonCodes.includes('MATURITY_TELEMETRY_COMPLETE'));
  });

  it('STABLE + >=3 epoch obs + >=24h + NOT_APPLICABLE → MATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const stoppedInput = buildRecordEvidenceObservationInput({
      category: 'STOPPED_WITH_STORAGE',
      ruleId: 'ec2.cost.stopped_with_storage',
      analysisRunId: 'run-stop-1',
      observationTimestamp: FIXED_OBSERVATION_TS_1,
    });
    const history = await replayAndCollect(repo, {
      name: 'stopped-persist',
      inputs: [
        stoppedInput,
        buildRecordEvidenceObservationInput({
          category: 'STOPPED_WITH_STORAGE',
          ruleId: 'ec2.cost.stopped_with_storage',
          analysisRunId: 'run-stop-2',
          observationTimestamp: FIXED_OBSERVATION_TS_2,
          recommendationVersion: 2,
        }),
        buildRecordEvidenceObservationInput({
          category: 'STOPPED_WITH_STORAGE',
          ruleId: 'ec2.cost.stopped_with_storage',
          analysisRunId: 'run-stop-3',
          observationTimestamp: FIXED_OBSERVATION_TS_3,
          recommendationVersion: 3,
        }),
      ],
      expectedStates: ['NEW', 'STABLE', 'STABLE'],
    });
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'NOT_APPLICABLE',
      dataCompleteness: 'NOT_APPLICABLE',
    });
    assert.equal(result.maturity, 'MATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_TELEMETRY_NOT_APPLICABLE'));
  });

  it('required + NO_DATA → IMMATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, buildPersistentRecommendationScenario());
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'NO_DATA',
    });
    assert.equal(result.maturity, 'IMMATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_TELEMETRY_NO_DATA'));
  });

  it('required + INSUFFICIENT → IMMATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, {
      name: 'two-stable',
      inputs: buildPersistentRecommendationScenario().inputs.slice(0, 2),
      expectedStates: ['NEW', 'STABLE'],
    });
    const result = evaluateCurrent(history, {
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'INSUFFICIENT',
    });
    assert.equal(result.maturity, 'IMMATURE');
    assert.ok(result.reasonCodes.includes('MATURITY_TELEMETRY_INSUFFICIENT'));
  });

  it('same normalized input + evaluatedAt → deepEqual', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = await replayAndCollect(repo, buildPersistentRecommendationScenario());
    const input = {
      sourceObservation: history[history.length - 1]!,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED' as const,
      dataCompleteness: 'COMPLETE' as const,
      evaluatedAt: EVALUATED_AT,
      config: EVIDENCE_MATURITY_V1_CONFIG,
    };
    const first = evaluateEvidenceMaturity(input);
    const second = evaluateEvidenceMaturity(input);
    assert.deepEqual(first, second);
  });

  it('invalid DTO throws typed technical error', () => {
    assert.throws(
      () =>
        evaluateEvidenceMaturity({
          sourceObservation: {
            ...buildRecordEvidenceObservationInput(),
            tenantId: '',
          } as never,
          findingHistory: [],
          telemetryApplicability: 'REQUIRED',
          dataCompleteness: 'COMPLETE',
          evaluatedAt: EVALUATED_AT,
        }),
      EvidenceMaturityEvaluationError,
    );
  });

  it('score is deterministic and bounded', () => {
    const score = computeMaturityScore({
      persistenceState: 'STABLE',
      stableEpoch: {
        observations: [],
        observationCount: 3,
        stableEpochHours: 48,
        earliestObservationTimestamp: FIXED_OBSERVATION_TS_1,
        latestObservationTimestamp: FIXED_OBSERVATION_TS_3,
      },
      telemetryApplicability: 'REQUIRED',
      evidenceCompleteness: 'COMPLETE',
      matureMinObservationCount: 3,
      matureMinStableEpochHours: 24,
    });
    assert.ok(score.score >= 0 && score.score <= 100);
    assert.equal(score.factors.length, 4);
  });

  it('101+ observation stable epoch pagination', async () => {
    const repo = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const service = new EvidenceMaturityService(maturityRepo, repo);
    const inputs = buildManyHistoricalObservations(101);
    for (const input of inputs) {
      await repo.recordObservation(input);
    }
    const lastInput = inputs[100]!;
    const history = await service.listAllObservationsForFinding({
      tenantId: lastInput.tenantId,
      accountId: lastInput.accountId,
      findingKey: lastInput.findingKey,
    });
    const epoch = computeCurrentStableEpoch({
      sourceObservation: history[history.length - 1]!,
      findingHistory: history,
    });
    assert.equal(epoch.observationCount, 101);
  });
});
