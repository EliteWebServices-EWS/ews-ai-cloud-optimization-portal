import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareVerificationOutcome } from '../../engines/verification/verification.comparator';
import { evaluatePostActionVerification } from '../../post-action-verification/evaluate-post-action-verification';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import { VERIFICATION_STATUS } from '../../shared/constants';
import {
  buildExecutionApiSuccessRecommendationPersistsInput,
  buildExecutionApiSuccessRecommendationResolvedInput,
  buildPostActionDegradedInput,
  buildPostActionInsufficientEvidenceInput,
  buildVerificationExpectation,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Post-action verification assessment semantics', () => {
  const service = new PostActionVerificationService();

  it('COMPLETED + expected state + healthy telemetry + recommendation resolved → RESOLVED', () => {
    const fixture = buildExecutionApiSuccessRecommendationResolvedInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-resolved',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.equal(assessment.outcome, 'RESOLVED');
    assert.equal(assessment.legacyVerificationStatus, VERIFICATION_STATUS.VERIFIED);
  });

  it('COMPLETED + expected state + healthy telemetry + recommendation persists → HEALTHY, not RESOLVED', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-healthy',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.equal(assessment.outcome, 'HEALTHY');
    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('COMPLETED + degraded telemetry → DEGRADED or ROLLBACK_CANDIDATE', () => {
    const fixture = buildPostActionDegradedInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-degraded',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.ok(['DEGRADED', 'ROLLBACK_CANDIDATE'].includes(assessment.outcome));
  });

  it('COMPLETED + telemetry missing → INSUFFICIENT_EVIDENCE', () => {
    const fixture = buildPostActionInsufficientEvidenceInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-insufficient',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.equal(assessment.outcome, 'INSUFFICIENT_EVIDENCE');
  });

  it('COMPLETED + recommendation state unknown → not RESOLVED', () => {
    const fixture = buildExecutionApiSuccessRecommendationResolvedInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      recommendationState: {
        findingKey: fixture.assessmentInput.recommendationState.findingKey,
        recommendationId: fixture.assessmentInput.recommendationState.recommendationId,
        present: null,
        sufficientEvidence: false,
      },
      workflowId: 'wf-rec-unknown',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('COMPLETED + state mismatch → not RESOLVED', () => {
    const fixture = buildExecutionApiSuccessRecommendationResolvedInput();
    const comparatorResult = compareVerificationOutcome({
      executionResult: fixture.executionResult,
      observation: fixture.observation,
      expectation: buildVerificationExpectation({
        expectedInstanceType: 't3.large',
      }),
    });

    const assessment = evaluatePostActionVerification({
      ...fixture.assessmentInput,
      comparatorResult,
    });

    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('COMPLETED + observed savings below threshold → not RESOLVED', () => {
    const fixture = buildPostActionDegradedInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      recommendationState: {
        findingKey: fixture.assessmentInput.recommendationState.findingKey,
        recommendationId: fixture.assessmentInput.recommendationState.recommendationId,
        present: false,
        sufficientEvidence: true,
      },
      workflowId: 'wf-savings-low',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('includes evidence references without duplicating full payloads', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-refs',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    assert.ok(assessment.executionReference.sourceRecordId);
    assert.ok(assessment.beforeEvidenceReference.sourceRecordId);
    assert.ok(assessment.telemetryEvidenceReference.sourceRecordId);
    assert.ok(assessment.recommendationStateReference.sourceRecordId);
  });
});
