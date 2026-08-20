import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { PostActionVerificationScopeError } from '../../post-action-verification/errors';
import { evaluatePostActionVerification } from '../../post-action-verification/evaluate-post-action-verification';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import { compareVerificationOutcome } from '../../engines/verification/verification.comparator';
import { VERIFICATION_STATUS } from '../../shared/constants';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';
import {
  buildCrossAccountVerificationDeniedInput,
  buildCrossTenantVerificationDeniedInput,
  buildExecutionApiSuccessRecommendationPersistsInput,
  buildVerificationExpectation,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Post-action verification tenant/account scope', () => {
  it('rejects cross-tenant evidence context scope', () => {
    assert.throws(
      () =>
        evaluatePostActionVerification({
          ...buildCrossTenantVerificationDeniedInput(),
          comparatorResult: {
            status: VERIFICATION_STATUS.PENDING,
            expectedSavings: 15,
            actualSavings: 0,
            verifiedSavings: 0,
            variance: -15,
            variancePercentage: -100,
            stateMatched: false,
            confidenceScore: 0,
            message: 'pending',
          },
        }),
      PostActionVerificationScopeError,
    );
  });

  it('rejects cross-account evidence context scope within same tenant', () => {
    assert.throws(
      () =>
        evaluatePostActionVerification({
          ...buildCrossAccountVerificationDeniedInput(),
          comparatorResult: {
            status: VERIFICATION_STATUS.PENDING,
            expectedSavings: 15,
            actualSavings: 0,
            verifiedSavings: 0,
            variance: -15,
            variancePercentage: -100,
            stateMatched: false,
            confidenceScore: 0,
            message: 'pending',
          },
        }),
      PostActionVerificationScopeError,
    );
  });

  it('Tenant A cannot read Tenant B verification outputs', async () => {
    const repository = new MockVerificationRepository();
    const service = new PostActionVerificationService(undefined, repository);
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();

    await service.evaluateAndPersist({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-tenant-a',
      executionId: 'exec-tenant-a',
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    const crossTenant = await repository.findByWorkflowId(TENANT_B, 'wf-tenant-a');
    assert.equal(crossTenant, undefined);
  });

  it('Tenant A cannot verify using Tenant B post-action evidence scope', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    assert.throws(
      () =>
        evaluatePostActionVerification({
          ...fixture.assessmentInput,
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          evidenceContextScope: { tenantId: TENANT_B, accountId: ACCOUNT_B },
          comparatorResult: compareVerificationOutcome({
            executionResult: fixture.executionResult,
            observation: fixture.observation!,
            expectation: buildVerificationExpectation(),
          }),
        }),
      PostActionVerificationScopeError,
    );
  });

  it('Same tenant Account A evidence cannot be used for Account B verification', () => {
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();
    assert.throws(
      () =>
        evaluatePostActionVerification({
          ...fixture.assessmentInput,
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          evidenceContextScope: { tenantId: TENANT_A, accountId: ACCOUNT_B },
          comparatorResult: compareVerificationOutcome({
            executionResult: fixture.executionResult,
            observation: fixture.observation!,
            expectation: buildVerificationExpectation(),
          }),
        }),
      PostActionVerificationScopeError,
    );
  });
});
