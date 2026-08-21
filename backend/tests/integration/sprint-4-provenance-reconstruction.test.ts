import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionLogService } from '../../services/action-log-service';
import { DecisionProvenanceReconstructionService } from '../../services/decision-provenance-reconstruction-service';
import { PROVENANCE_REASON } from '../../provenance-reconstruction/reason-codes';
import { ProvenanceScopeError } from '../../provenance-reconstruction/errors';
import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { MockExecutionPlanRepository } from '../../repositories/mock/mock-execution-plan-repository';
import { ACCOUNT_A, ACCOUNT_B, TENANT_A, TENANT_B } from '../fixtures/evidence/identities';
import {
  buildCompleteExecutedAndVerifiedEvents,
  buildCrossTenantEvent,
  seedVerifiedExecutionSources,
  SPRINT4_CORRELATION_ID,
  SPRINT4_DECISION_ID,
  SPRINT4_EXECUTION_ID,
  SPRINT4_WORKFLOW_ID,
  seedActionLogEvents,
} from '../fixtures/sprint-4-provenance/provenance-fixtures';

async function seedVerifiedProvenanceFixture(
  repository: MockActionLogRepository,
  executionPlanRepository: MockExecutionPlanRepository,
  verificationRepository: MockVerificationRepository,
): Promise<void> {
  await seedActionLogEvents(repository, buildCompleteExecutedAndVerifiedEvents());
  await seedVerifiedExecutionSources({
    executionPlanRepository,
    verificationRepository,
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    executionId: SPRINT4_EXECUTION_ID,
    workflowId: SPRINT4_WORKFLOW_ID,
  });
}

describe('Sprint 4 decision provenance reconstruction service', () => {
  it('reconstructs source-verified COMPLETE by decisionId with tenant and account scope', async () => {
    const repository = new MockActionLogRepository();
    const executionPlanRepository = new MockExecutionPlanRepository();
    const verificationRepository = new MockVerificationRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
      { executionPlanRepository, verificationRepository },
    );

    await seedVerifiedProvenanceFixture(
      repository,
      executionPlanRepository,
      verificationRepository,
    );

    const result = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });

    assert.equal(result.sourceVerificationMode, 'source_verified');
    assert.equal(result.completeness, 'COMPLETE');
    assert.equal(result.correlationId, SPRINT4_CORRELATION_ID);
    assert.equal(result.decisionId, SPRINT4_DECISION_ID);
    assert.ok(result.orderedEvents.length >= 5);
  });

  it('reconstructs source-verified COMPLETE by correlationId', async () => {
    const repository = new MockActionLogRepository();
    const executionPlanRepository = new MockExecutionPlanRepository();
    const verificationRepository = new MockVerificationRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
      { executionPlanRepository, verificationRepository },
    );

    await seedVerifiedProvenanceFixture(
      repository,
      executionPlanRepository,
      verificationRepository,
    );

    const result = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
    });

    assert.equal(result.completeness, 'COMPLETE');
  });

  it('default source_verified mode fails safely when required sources were not checked', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    await seedActionLogEvents(repository, buildCompleteExecutedAndVerifiedEvents());

    const result = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });

    assert.equal(result.sourceVerificationMode, 'source_verified');
    assert.notEqual(result.completeness, 'COMPLETE');
    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_NOT_VERIFIED,
      ),
    );
    assert.ok(result.orderedEvents.length >= 5);
  });

  it('CROSS_TENANT_RECONSTRUCTION_DENIED when tenant scope mismatches', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    await seedActionLogEvents(repository, [buildCrossTenantEvent()]);

    const denied = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
    });

    assert.equal(denied.orderedEvents.length, 0);
    assert.equal(denied.completeness, 'INCOMPLETE');
    assert.ok(
      denied.reasonCodes.includes(PROVENANCE_REASON.PROVENANCE_LIFECYCLE_NOT_FOUND),
    );
  });

  it('nonexistent and cross-tenant decisionId lookups are indistinguishable', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    await seedActionLogEvents(repository, [buildCrossTenantEvent()]);

    const crossTenant = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });
    const nonexistent = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: 'decision-does-not-exist',
    });

    assert.deepEqual(
      {
        completeness: crossTenant.completeness,
        reasonCodes: crossTenant.reasonCodes,
        orderedEventsLength: crossTenant.orderedEvents.length,
        sourceReferencesLength: crossTenant.sourceReferences.length,
        stagesPresent: crossTenant.stagesPresent,
        stagesMissing: crossTenant.stagesMissing,
      },
      {
        completeness: nonexistent.completeness,
        reasonCodes: nonexistent.reasonCodes,
        orderedEventsLength: nonexistent.orderedEvents.length,
        sourceReferencesLength: nonexistent.sourceReferences.length,
        stagesPresent: nonexistent.stagesPresent,
        stagesMissing: nonexistent.stagesMissing,
      },
    );
  });

  it('nonexistent and cross-tenant correlationId lookups are indistinguishable', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    await seedActionLogEvents(repository, [buildCrossTenantEvent()]);

    const crossTenant = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: SPRINT4_CORRELATION_ID,
    });
    const nonexistent = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: 'corr-does-not-exist',
    });

    assert.deepEqual(
      {
        completeness: crossTenant.completeness,
        reasonCodes: crossTenant.reasonCodes,
        orderedEventsLength: crossTenant.orderedEvents.length,
        sourceReferencesLength: crossTenant.sourceReferences.length,
        stagesPresent: crossTenant.stagesPresent,
        stagesMissing: crossTenant.stagesMissing,
      },
      {
        completeness: nonexistent.completeness,
        reasonCodes: nonexistent.reasonCodes,
        orderedEventsLength: nonexistent.orderedEvents.length,
        sourceReferencesLength: nonexistent.sourceReferences.length,
        stagesPresent: nonexistent.stagesPresent,
        stagesMissing: nonexistent.stagesMissing,
      },
    );
  });

  it('denies cross-tenant decisionId lookup without leaking Tenant B lifecycle', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    await seedActionLogEvents(repository, [buildCrossTenantEvent()]);

    const tenantBResult = await service.reconstruct({
      tenantId: TENANT_B,
      accountId: ACCOUNT_B,
      decisionId: SPRINT4_DECISION_ID,
    });
    assert.equal(tenantBResult.orderedEvents.length, 1);

    const tenantAAttempt = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });
    assert.equal(tenantAAttempt.orderedEvents.length, 0);
    assert.notEqual(tenantAAttempt.completeness, 'COMPLETE');
  });

  it('degrades completeness when ActionLog exists but required source records are unavailable', async () => {
    const repository = new MockActionLogRepository();
    const executionPlanRepository = new MockExecutionPlanRepository();
    const verificationRepository = new MockVerificationRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
      {
        executionPlanRepository,
        verificationRepository,
      },
    );

    await seedActionLogEvents(repository, buildCompleteExecutedAndVerifiedEvents());

    const result = await service.reconstruct({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      decisionId: SPRINT4_DECISION_ID,
    });

    assert.notEqual(result.completeness, 'COMPLETE');
    assert.equal(result.completeness, 'PARTIAL');
    assert.ok(
      result.reasonCodes.includes(
        PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_UNAVAILABLE,
      ),
    );
    assert.ok(result.orderedEvents.length >= 5);
    assert.ok(
      result.sourceReferences.some(
        (reference) => reference.availability === 'UNAVAILABLE',
      ),
    );
  });

  it('rejects account scope contamination from mixed-account ActionLog rows', async () => {
    const repository = new MockActionLogRepository();
    const service = new DecisionProvenanceReconstructionService(
      new ActionLogService(repository),
    );

    const contaminated = buildCompleteExecutedAndVerifiedEvents().map((event, index) =>
      index === 0 ? { ...event, accountId: ACCOUNT_B } : event,
    );
    await seedActionLogEvents(repository, contaminated);

    await assert.rejects(
      () =>
        service.reconstruct({
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          correlationId: SPRINT4_CORRELATION_ID,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProvenanceScopeError);
        assert.match(
          String(error.message),
          new RegExp(PROVENANCE_REASON.PROVENANCE_ACCOUNT_SCOPE_VIOLATION),
        );
        return true;
      },
    );
  });
});
