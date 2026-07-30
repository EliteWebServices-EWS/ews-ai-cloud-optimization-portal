import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ExecutionAdapterError, EXECUTION_MODES } from '../../execution/adapters/types';
import { initialApprovalStatus } from '../../repositories/contracts/execution-plan-repository';
import { InvalidExecutionTransitionError } from '../../services/execution-lifecycle';

import {
  buildOrchestratorContext,
  buildPlanInput,
  createInMemoryExecutionStores,
  createTestOrchestrator,
  TENANT_A,
} from '../integration/execution/fixtures';

describe('Execution authorization and approval enforcement', () => {
  it('rejects orchestrator calls with missing tenant context', async () => {
    const { orchestrator } = createTestOrchestrator();
    await assert.rejects(
      () =>
        orchestrator.run(
          buildOrchestratorContext({ tenantId: '' }),
          { service: 'ec2', action: 'START_INSTANCE', resourceId: 'i-1' },
        ),
      ExecutionAdapterError,
    );
  });

  it('blocks plan execution transition without approval when required', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-auth-1',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    await assert.rejects(
      () =>
        plans.transitionStatus(
          TENANT_A,
          created.executionId,
          'EXECUTING',
          { expectedVersion: created.version },
        ),
      InvalidExecutionTransitionError,
    );
  });

  it('rejects unsupported actions before mutation', async () => {
    const { orchestrator } = createTestOrchestrator();
    await assert.rejects(
      () =>
        orchestrator.run(
          buildOrchestratorContext({ mode: EXECUTION_MODES.VALIDATION }),
          { service: 'ec2', action: 'TERMINATE_INSTANCE', resourceId: 'i-1' },
        ),
      ExecutionAdapterError,
    );
  });
});
