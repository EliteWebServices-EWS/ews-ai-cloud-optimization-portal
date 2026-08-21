import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../execution';
import { EXECUTION_MODES } from '../../execution/adapters/types';
import { RepositoryNotFoundError } from '../../database';
import {
  evaluateActionPolicyActorGate,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { evaluatePrivilegedMfa, PRIVILEGED_OPERATIONS } from '../../auth/privileged-mfa';
import type { RequestSecurityContext } from '../../auth/request-security-context';
import { TENANT_ROLES } from '../../auth/tenant-roles';
import { ExecutionApiService } from '../../services/execution-api-service';
import { AppError } from '../../shared/utils';
import { createInMemoryExecutionStores, TENANT_A, TENANT_B } from './execution/fixtures';
import {
  buildExecutionApiPolicyContext,
  buildProductionPolicyContext,
} from '../fixtures/action-policy/policy-fixtures';
import type { CreateExecutionPlanBody } from '../../api/execution-api-validation';
import type { SisumRole } from '../../auth';
import { createTestOrchestrator, buildOrchestratorContext } from './execution/fixtures';

function actor(tenantId = TENANT_A) {
  return {
    tenantId,
    actorId: 'legacy-actor',
    actor: {
      authenticated: true,
      userId: 'legacy-actor',
      email: 'legacy-actor@example.com',
      roles: ['admin'] as SisumRole[],
    },
    requestId: 'req-legacy',
    correlationId: 'corr-legacy',
  };
}

function legacyBody(overrides: Partial<CreateExecutionPlanBody> = {}): CreateExecutionPlanBody {
  return {
    workflowId: 'wf-legacy',
    recommendationId: 'rec-legacy',
    approvalRequired: true,
    riskLevel: 'LOW',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-legacy',
        description: 'start',
      },
    ],
    rollbackPlan: { strategy: 'REVERSE', steps: [], automatic: true },
    ...overrides,
  };
}

describe('Sprint 3 legacy execution plan safety', () => {
  const previousProductionFlag = process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
  const previousProviderMode = process.env.PROVIDER_MODE;

  before(() => {
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
    process.env.PROVIDER_MODE = 'aws';
  });

  after(() => {
    if (previousProductionFlag === undefined) {
      delete process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
    } else {
      process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = previousProductionFlag;
    }
    if (previousProviderMode === undefined) {
      delete process.env.PROVIDER_MODE;
    } else {
      process.env.PROVIDER_MODE = previousProviderMode;
    }
  });

  function createService(stores = createInMemoryExecutionStores()) {
    const orchestrator = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(() => ({
        ec2: {
          send: async (command: { constructor: { name: string } }) => {
            if (command.constructor.name === 'DescribeInstancesCommand') {
              return {
                Reservations: [
                  {
                    Instances: [
                      { InstanceId: 'i-legacy', State: { Name: 'running' }, Tags: [] },
                    ],
                  },
                ],
              };
            }
            return {};
          },
        } as never,
      })),
      runs: stores.runs,
    });

    return new ExecutionApiService({
      plans: stores.plans,
      runs: stores.runs,
      history: stores.history,
      orchestrator,
    });
  }

  it('LEGACY_GAP corrected: production execute fails closed without policy provenance', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), legacyBody());
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const approved = await service.approvePlan(
      actor(),
      pending.executionId,
      pending.version,
    );

    await assert.rejects(
      () => service.executePlan(actor(), approved.executionId, approved.version),
      (error: unknown) =>
        error instanceof AppError && error.code === 'ACTION_POLICY_MISSING',
    );
  });

  it('legacy production plan requiring approval still enforces approval lifecycle', async () => {
    const service = createService();
    const created = await service.createPlan(
      actor(),
      legacyBody({ policyContext: buildExecutionApiPolicyContext({ resourceId: 'i-legacy' }) }),
    );

    assert.equal(created.approvalRequired, true);

    await assert.rejects(
      () => service.executePlan(actor(), created.executionId, created.version),
      (error: unknown) => error instanceof AppError && error.code === 'CONFLICT',
    );

    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const approved = await service.approvePlan(
      actor(),
      pending.executionId,
      pending.version,
    );

    const outcome = await service.executePlan(
      actor(),
      approved.executionId,
      approved.version,
    );
    assert.equal(outcome.result.status, 'SUCCEEDED');
  });

  it('legacy production plan missing required approval cannot execute', async () => {
    const service = createService();
    const created = await service.createPlan(
      actor(),
      legacyBody({ policyContext: buildExecutionApiPolicyContext({ resourceId: 'i-legacy' }) }),
    );
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });

    await assert.rejects(
      () => service.executePlan(actor(), pending.executionId, pending.version),
      (error: unknown) => error instanceof AppError && error.code === 'CONFLICT',
    );
  });

  it('legacy production execution without MFA is blocked at policy actor gate', () => {
    const gate = evaluateActionPolicyActorGate({
      authorized: true,
      mfaVerified: false,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
  });

  it('legacy privileged MFA requirement remains enforced by auth layer contract', () => {
    const context: RequestSecurityContext = {
      tenantId: TENANT_A,
      requestId: 'req-legacy-mfa',
      correlationId: 'corr-legacy-mfa',
      roles: ['admin'],
      userId: 'owner-legacy',
      email: 'owner-legacy@example.com',
      claimPresent: true,
      usedFallback: false,
      invalidClaim: false,
    };

    const mfa = evaluatePrivilegedMfa(
      context,
      {
        authenticated: true,
        userId: 'owner-legacy',
        email: 'owner-legacy@example.com',
        groups: ['admin'],
        rawGroups: ['admin'],
        tokenUse: 'access',
        clientId: 'client-legacy',
        tenantId: TENANT_A,
        sessionMfaVerified: false,
      },
      PRIVILEGED_OPERATIONS.EXECUTION_EXECUTE,
      { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
    );

    assert.equal(mfa.required, true);
    assert.equal(mfa.satisfied, false);
  });

  it('legacy cross-tenant execution is denied', async () => {
    const service = createService();
    const created = await service.createPlan(
      actor(TENANT_A),
      legacyBody({ policyContext: buildProductionPolicyContext({ resourceId: 'i-legacy' }) }),
    );
    const pending = await service.updatePlan(actor(TENANT_A), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const approved = await service.approvePlan(
      actor(TENANT_A),
      pending.executionId,
      pending.version,
    );

    await assert.rejects(
      () => service.executePlan(actor(TENANT_B), approved.executionId, approved.version),
      RepositoryNotFoundError,
    );
  });

  it('legacy simulation path remains separate from production plan execution', async () => {
    const { orchestrator } = createTestOrchestrator(() => ({}) as never);
    const result = await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.DRY_RUN }),
      {
        service: 'ec2',
        action: 'START_INSTANCE',
        resourceId: 'i-legacy-sim',
      },
    );

    assert.equal(result.mode, EXECUTION_MODES.DRY_RUN);
    assert.notEqual(result.mode, EXECUTION_MODES.PRODUCTION);
  });

  describe('Sprint 4 override governance', () => {
    it('overrides a REJECTED plan to APPROVED with durable provenance', async () => {
      const service = createService();
      const created = await service.createPlan(
        actor(TENANT_A),
        legacyBody({ policyContext: buildProductionPolicyContext({ resourceId: 'i-legacy' }) }),
      );
      const pending = await service.updatePlan(actor(TENANT_A), created.executionId, {
        expectedVersion: created.version,
        submitForApproval: true,
      });
      const rejected = await service.rejectPlan(
        actor(TENANT_A),
        pending.executionId,
        pending.version,
        'insufficient evidence at the time',
      );

      const overridden = await service.overridePlan(
        actor(TENANT_A),
        rejected.executionId,
        rejected.version,
        { overrideDecision: 'APPROVED', reason: 'Re-reviewed with additional telemetry' },
      );

      assert.equal(overridden.planStatus, 'APPROVED');
      assert.equal(overridden.approvalStatus, 'APPROVED');
      assert.equal(overridden.approvedBy, 'legacy-actor');
      assert.ok(Array.isArray(overridden.metadata?.approvalOverrideHistory));
      const history = overridden.metadata!.approvalOverrideHistory as Array<Record<string, unknown>>;
      assert.equal(history.length, 1);
      assert.equal(history[0].overrideDecision, 'APPROVED');
      assert.equal(history[0].reason, 'Re-reviewed with additional telemetry');
    });

    it('rejects an override that repeats the current decision', async () => {
      const service = createService();
      const created = await service.createPlan(
        actor(TENANT_A),
        legacyBody({ policyContext: buildProductionPolicyContext({ resourceId: 'i-legacy' }) }),
      );
      const pending = await service.updatePlan(actor(TENANT_A), created.executionId, {
        expectedVersion: created.version,
        submitForApproval: true,
      });
      const approved = await service.approvePlan(actor(TENANT_A), pending.executionId, pending.version);

      await assert.rejects(() =>
        service.overridePlan(actor(TENANT_A), approved.executionId, approved.version, {
          overrideDecision: 'APPROVED',
          reason: 'Attempting a no-op override',
        }),
      );
    });

    it('rejects an override on a plan that has not been decided yet', async () => {
      const service = createService();
      const created = await service.createPlan(
        actor(TENANT_A),
        legacyBody({ policyContext: buildProductionPolicyContext({ resourceId: 'i-legacy' }) }),
      );

      await assert.rejects(() =>
        service.overridePlan(actor(TENANT_A), created.executionId, created.version, {
          overrideDecision: 'APPROVED',
          reason: 'Cannot override a draft plan',
        }),
      );
    });

    it('legacy cross-tenant override is denied', async () => {
      const service = createService();
      const created = await service.createPlan(
        actor(TENANT_A),
        legacyBody({ policyContext: buildProductionPolicyContext({ resourceId: 'i-legacy' }) }),
      );
      const pending = await service.updatePlan(actor(TENANT_A), created.executionId, {
        expectedVersion: created.version,
        submitForApproval: true,
      });
      const rejected = await service.rejectPlan(
        actor(TENANT_A),
        pending.executionId,
        pending.version,
        'not ready',
      );

      await assert.rejects(
        () =>
          service.overridePlan(actor(TENANT_B), rejected.executionId, rejected.version, {
            overrideDecision: 'APPROVED',
            reason: 'Tenant B should never reach this plan',
          }),
        RepositoryNotFoundError,
      );
    });

    it('ActionLogEmitter exposes approval override emission distinct from grant/reject', () => {
      const methodNames = Object.getOwnPropertyNames(ActionLogEmitter.prototype);
      assert.ok(methodNames.includes('emitAfterApprovalOverridden'));
    });
  });
});


