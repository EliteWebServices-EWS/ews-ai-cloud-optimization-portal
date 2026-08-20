import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluatePostActionVerification } from '../../post-action-verification/evaluate-post-action-verification';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import {
  buildExecutionApiSuccessRecommendationPersistsInput,
  buildExecutionApiSuccessRecommendationResolvedInput,
  buildPostActionDegradedInput,
  buildPostActionInsufficientEvidenceInput,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';
import { compareVerificationOutcome } from '../../engines/verification/verification.comparator';

describe('Sprint 3 release gate blocking assertions', () => {
  const service = new PostActionVerificationService();

  it('blocks Execution COMPLETED automatically meaning RESOLVED', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-gate',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });
    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('blocks missing telemetry becoming HEALTHY', () => {
    const fixture = buildPostActionInsufficientEvidenceInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-gate',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });
    assert.notEqual(assessment.outcome, 'HEALTHY');
    assert.equal(assessment.outcome, 'INSUFFICIENT_EVIDENCE');
  });

  it('blocks missing recommendation evidence becoming RESOLVED', () => {
    const fixture = buildExecutionApiSuccessRecommendationResolvedInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      recommendationState: {
        ...fixture.assessmentInput.recommendationState,
        present: null,
        sufficientEvidence: false,
      },
      workflowId: 'wf-gate',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });
    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('blocks ROLLBACK_CANDIDATE without measurable degradation evidence', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const assessment = evaluatePostActionVerification({
      ...fixture.assessmentInput,
      telemetry: {
        available: true,
        qualityAdequate: true,
        degraded: false,
      },
      comparatorResult: compareVerificationOutcome({
        executionResult: fixture.executionResult,
        observation: fixture.observation!,
        expectation: fixture.expectation,
      }),
    });
    assert.notEqual(assessment.outcome, 'ROLLBACK_CANDIDATE');
  });

  it('requires evidence references on authoritative verification assessment', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      workflowId: 'wf-gate',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });
    assert.ok(assessment.executionReference.sourceRecordId);
    assert.ok(assessment.telemetryEvidenceReference.sourceRecordId);
    assert.ok(assessment.recommendationStateReference.sourceRecordId);
  });

  it('blocks degraded telemetry from resolving recommendation', () => {
    const fixture = buildPostActionDegradedInput();
    const assessment = service.evaluate({
      ...fixture.assessmentInput,
      recommendationState: {
        ...fixture.assessmentInput.recommendationState,
        present: false,
        sufficientEvidence: true,
      },
      workflowId: 'wf-gate',
      executionId: fixture.executionResult.executionId,
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });
    assert.notEqual(assessment.outcome, 'RESOLVED');
  });
});
