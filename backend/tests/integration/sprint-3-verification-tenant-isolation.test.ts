import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { PostActionVerificationService } from '../../post-action-verification/post-action-verification-service';
import { ACCOUNT_A, TENANT_A, TENANT_B } from '../fixtures/evidence/identities';
import { buildExecutionApiSuccessRecommendationPersistsInput } from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

describe('Sprint 3 verification tenant isolation integration', () => {
  it('cross-tenant verification lookup returns safe not-found', async () => {
    const repository = new MockVerificationRepository();
    const service = new PostActionVerificationService(undefined, repository);
    const fixture = buildExecutionApiSuccessRecommendationPersistsInput();

    await service.evaluateAndPersist({
      ...fixture.assessmentInput,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      workflowId: 'wf-tenant-isolation',
      executionId: 'exec-tenant-isolation',
      expectation: fixture.expectation,
      observation: fixture.observation,
      executionResult: fixture.executionResult,
    });

    const crossTenantWorkflow = await repository.findByWorkflowId(
      TENANT_B,
      'wf-tenant-isolation',
    );
    const crossTenantExecution = await repository.findByExecutionId(
      TENANT_B,
      'exec-tenant-isolation',
    );

    assert.equal(crossTenantWorkflow, undefined);
    assert.equal(crossTenantExecution, undefined);
  });
});
