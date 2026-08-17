import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EVIDENCE_MATURITY_V1_CONFIG,
  computeCurrentStableEpoch,
  evaluateEvidenceMaturity,
} from '../../evidence-maturity';
import {
  buildRecommendationFingerprintInputFromEc2Cost,
} from '../../persistence-intelligence/recommendation-fingerprint';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { EvidenceMaturityService } from '../../services/evidence-maturity-service';
import {
  buildRecordEvidenceObservationInput,
} from '../fixtures/evidence';

const EVALUATED_AT = '2026-08-12T12:10:00.000Z';
const HOUR_MS = 60 * 60 * 1000;

function fingerprintInputA() {
  return buildRecommendationFingerprintInputFromEc2Cost({
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: 'i-abc',
    region: 'us-east-1',
    category: 'UNDERUTILIZED',
    recommendedAction: 'Rightsize to t3.medium',
    ruleId: 'ec2.cost.review_downsize',
    ruleVersion: '1.0.0',
  });
}

function fingerprintInputB() {
  return buildRecommendationFingerprintInputFromEc2Cost({
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: 'i-abc',
    region: 'us-east-1',
    category: 'UNDERUTILIZED',
    recommendedAction: 'Stop instance',
    ruleId: 'ec2.cost.review_downsize',
    ruleVersion: '1.0.0',
  });
}

async function collectHistory(
  repo: MockEvidenceObservationRepository, findingKey: string, tenantId: string, accountId: string) {
  const all = [];
  let nextToken: string | undefined;
  do {
    const page = await repo.listObservationsForFinding({
      tenantId,
      accountId,
      findingKey,
      limit: 25,
      nextToken,
    });
    all.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  return all.sort((a, b) => a.observationTimestamp.localeCompare(b.observationTimestamp));
}

describe('evidence maturity hardening', () => {
  it('MATURE_MIN_STABLE_EPOCH_HOURS uses central config for classification gating', () => {
    assert.equal(EVIDENCE_MATURITY_V1_CONFIG.matureMinStableEpochHours, 24);
  });

  it('23.999 stable-epoch hours with 3 STABLE observations → PARTIAL not MATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const timestamps = [base, base + 8 * HOUR_MS, base + 23.999 * HOUR_MS].map((ms) =>
      new Date(ms).toISOString(),
    );
    const history = [];
    for (const [index, observationTimestamp] of timestamps.entries()) {
      const recorded = await repo.recordObservation(
        buildRecordEvidenceObservationInput({
          analysisRunId: `run-boundary-low-${index}`,
          observationTimestamp,
          collectionTimestamp: observationTimestamp,
          recommendationVersion: index + 1,
        }),
      );
      history.push(recorded.observation);
    }
    const result = evaluateEvidenceMaturity({
      sourceObservation: history[2]!,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.ok(result.stableEpochHours < 24);
    assert.equal(result.maturity, 'PARTIAL');
    assert.notEqual(result.maturity, 'MATURE');
  });

  it('exactly 24.0 stable-epoch hours with 3 STABLE observations → MATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const timestamps = [base, base + 12 * HOUR_MS, base + 24 * HOUR_MS].map((ms) =>
      new Date(ms).toISOString(),
    );
    const history = [];
    for (const [index, observationTimestamp] of timestamps.entries()) {
      const recorded = await repo.recordObservation(
        buildRecordEvidenceObservationInput({
          analysisRunId: `run-boundary-exact-${index}`,
          observationTimestamp,
          collectionTimestamp: observationTimestamp,
          recommendationVersion: index + 1,
        }),
      );
      history.push(recorded.observation);
    }
    const result = evaluateEvidenceMaturity({
      sourceObservation: history[2]!,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(result.stableEpochHours, 24);
    assert.equal(result.maturity, 'MATURE');
  });

  it('48 stable-epoch hours with 3 STABLE observations → MATURE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const timestamps = [base, base + 24 * HOUR_MS, base + 48 * HOUR_MS].map((ms) =>
      new Date(ms).toISOString(),
    );
    const history = [];
    for (const [index, observationTimestamp] of timestamps.entries()) {
      const recorded = await repo.recordObservation(
        buildRecordEvidenceObservationInput({
          analysisRunId: `run-boundary-high-${index}`,
          observationTimestamp,
          collectionTimestamp: observationTimestamp,
          recommendationVersion: index + 1,
        }),
      );
      history.push(recorded.observation);
    }
    const result = evaluateEvidenceMaturity({
      sourceObservation: history[2]!,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(result.stableEpochHours, 48);
    assert.equal(result.maturity, 'MATURE');
  });

  it('A,A,A,B,B,B final epoch count = 3 not 6', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const fpA = fingerprintInputA();
    const fpB = fingerprintInputB();
    const inputs = [];
    for (let index = 0; index < 6; index += 1) {
      inputs.push(
        buildRecordEvidenceObservationInput({
          analysisRunId: `run-epoch-${index}`,
          observationTimestamp: new Date(base + index * HOUR_MS).toISOString(),
          collectionTimestamp: new Date(base + index * HOUR_MS).toISOString(),
          fingerprintInput: index < 3 ? fpA : fpB,
          recommendedAction: index < 3 ? 'Rightsize to t3.medium' : 'Stop instance',
          recommendationVersion: index + 1,
        }),
      );
    }
    for (const input of inputs) {
      await repo.recordObservation(input);
    }
    const history = await collectHistory(repo, inputs[0]!.findingKey, inputs[0]!.tenantId, inputs[0]!.accountId);
    const last = history[history.length - 1]!;
    const epoch = computeCurrentStableEpoch({ sourceObservation: last, findingHistory: history });
    assert.equal(epoch.observationCount, 3);
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: last,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(assessment.observationCount, 3);
    assert.equal(assessment.stableEpochObservationCount, 3);
    assert.notEqual(assessment.observationCount, 6);
  });

  it('A,A,B,A final A epoch count = 1 (does not merge prior A epoch)', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const fpA = fingerprintInputA();
    const fpB = fingerprintInputB();
    const sequence = [
      { fp: fpA, action: 'Rightsize to t3.medium' },
      { fp: fpA, action: 'Rightsize to t3.medium' },
      { fp: fpB, action: 'Stop instance' },
      { fp: fpA, action: 'Rightsize to t3.medium' },
    ];
    const inputs = sequence.map((entry, index) =>
      buildRecordEvidenceObservationInput({
        analysisRunId: `run-split-${index}`,
        observationTimestamp: new Date(base + index * HOUR_MS).toISOString(),
        collectionTimestamp: new Date(base + index * HOUR_MS).toISOString(),
        fingerprintInput: entry.fp,
        recommendedAction: entry.action,
        recommendationVersion: index + 1,
      }),
    );
    for (const input of inputs) {
      await repo.recordObservation(input);
    }
    const history = await collectHistory(repo, inputs[0]!.findingKey, inputs[0]!.tenantId, inputs[0]!.accountId);
    const last = history[history.length - 1]!;
    const epoch = computeCurrentStableEpoch({ sourceObservation: last, findingHistory: history });
    assert.equal(epoch.observationCount, 1);
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: last,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(assessment.sourcePersistenceState, 'CHANGED');
    assert.equal(assessment.maturity, 'IMMATURE');
    assert.equal(assessment.stableEpochObservationCount, 1);
  });

  it('stable epoch uses observation timestamps when inserted out of order', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const ordered = [0, 24, 48].map((hours) =>
      buildRecordEvidenceObservationInput({
        analysisRunId: `run-ooo-${hours}`,
        observationTimestamp: new Date(base + hours * HOUR_MS).toISOString(),
        collectionTimestamp: new Date(base + hours * HOUR_MS).toISOString(),
        recommendationVersion: hours / 24 + 1,
      }),
    );
    await repo.recordObservation(ordered[2]!);
    await repo.recordObservation(ordered[0]!);
    await repo.recordObservation(ordered[1]!);
    const history = await collectHistory(repo, ordered[0]!.findingKey, ordered[0]!.tenantId, ordered[0]!.accountId);
    const last = history.find((obs) => obs.analysisRunId === 'run-ooo-48')!;
    const epoch = computeCurrentStableEpoch({ sourceObservation: last, findingHistory: history });
    assert.equal(epoch.observationCount, 3);
    assert.equal(epoch.stableEpochHours, 48);
  });

  it('persistenceHours differs from stableEpochHours on multi-observation epoch', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const timestamps = [base, base + 24 * HOUR_MS, base + 48 * HOUR_MS].map((ms) =>
      new Date(ms).toISOString(),
    );
    const history = [];
    for (const [index, observationTimestamp] of timestamps.entries()) {
      const recorded = await repo.recordObservation(
        buildRecordEvidenceObservationInput({
          analysisRunId: `run-hours-${index}`,
          observationTimestamp,
          collectionTimestamp: observationTimestamp,
          recommendationVersion: index + 1,
        }),
      );
      history.push(recorded.observation);
    }
    const last = history[2]!;
    const result = evaluateEvidenceMaturity({
      sourceObservation: last,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(result.persistenceHours, 24);
    assert.equal(result.stableEpochHours, 48);
    assert.notEqual(result.persistenceHours, result.stableEpochHours);
  });

  it('high score cannot override PARTIAL telemetry ceiling', async () => {
    const repo = new MockEvidenceObservationRepository();
    const base = Date.parse('2026-08-01T00:00:00.000Z');
    const timestamps = [base, base + 24 * HOUR_MS, base + 48 * HOUR_MS].map((ms) =>
      new Date(ms).toISOString(),
    );
    const history = [];
    for (const [index, observationTimestamp] of timestamps.entries()) {
      const recorded = await repo.recordObservation(
        buildRecordEvidenceObservationInput({
          analysisRunId: `run-score-${index}`,
          observationTimestamp,
          collectionTimestamp: observationTimestamp,
          recommendationVersion: index + 1,
        }),
      );
      history.push(recorded.observation);
    }
    const result = evaluateEvidenceMaturity({
      sourceObservation: history[2]!,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'PARTIAL',
      evaluatedAt: EVALUATED_AT,
    });
    assert.ok(result.score >= 80);
    assert.equal(result.maturity, 'PARTIAL');
  });

  it('CHANGED first observation in new epoch is IMMATURE; next STABLE may be PARTIAL', async () => {
    const repo = new MockEvidenceObservationRepository();
    const scenario = buildRecordEvidenceObservationInput();
    const changedInput = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-changed-epoch',
      observationTimestamp: '2026-08-11T12:00:00.000Z',
      collectionTimestamp: '2026-08-11T12:05:00.000Z',
      recommendedAction: 'Stop instance',
      fingerprintInput: fingerprintInputB(),
      recommendationVersion: 2,
    });
    await repo.recordObservation(scenario);
    const changed = await repo.recordObservation(changedInput);
    const changedAssessment = evaluateEvidenceMaturity({
      sourceObservation: changed.observation,
      findingHistory: [changed.observation],
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(changedAssessment.maturity, 'IMMATURE');
    assert.equal(changedAssessment.stableEpochObservationCount, 1);

    const stableAgain = await repo.recordObservation(
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-changed-stable',
        observationTimestamp: '2026-08-12T12:00:00.000Z',
        collectionTimestamp: '2026-08-12T12:05:00.000Z',
        recommendedAction: 'Stop instance',
        fingerprintInput: fingerprintInputB(),
        recommendationVersion: 3,
      }),
    );
    const history = await collectHistory(repo, scenario.findingKey, scenario.tenantId, scenario.accountId);
    const stableAssessment = evaluateEvidenceMaturity({
      sourceObservation: stableAgain.observation,
      findingHistory: history,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(stableAssessment.sourcePersistenceState, 'STABLE');
    assert.equal(stableAssessment.maturity, 'PARTIAL');
  });
});

describe('evidence maturity technical failure', () => {
  it('evaluator failure does not persist maturity record', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const service = new EvidenceMaturityService(maturityRepo, observations);
    const recorded = await observations.recordObservation(buildRecordEvidenceObservationInput());
    const invalidObservation = { ...recorded.observation, tenantId: '' };

    await assert.rejects(
      () =>
        service.evaluateAndPersist({
          observation: invalidObservation,
          evaluatedAt: EVALUATED_AT,
        }),
      /Missing tenantId/,
    );

    const list = await maturityRepo.listAssessmentsForFinding({
      tenantId: recorded.observation.tenantId,
      accountId: recorded.observation.accountId,
      findingKey: recorded.observation.findingKey,
    });
    assert.equal(list.items.length, 0);
  });
});
