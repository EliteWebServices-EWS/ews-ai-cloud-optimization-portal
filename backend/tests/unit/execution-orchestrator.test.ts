import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AUDIT_EVENTS } from '../../audit';
import {
  createDefaultExecutionAdapterRegistry,
} from '../../execution/adapters/adapter-registry';
import { ExecutionAdapterError, EXECUTION_MODES, type AdapterExecutionMode } from '../../execution/adapters/types';
import {
  createExecutionOrchestrator,
} from '../../execution/execution-orchestrator';
import { MockExecutionRunRepository } from '../../repositories/mock/mock-execution-run-repository';

const actor = {
  authenticated: true,
  userId: 'user-1',
  email: 'user@example.com',
  roles: ['admin'] as import('../../auth').SisumRole[],
};

function baseContext(mode: AdapterExecutionMode) {
  return {
    tenantId: 'tenant-a',
    actorId: 'user-1',
    actor,
    correlationId: 'corr-1',
    requestId: 'req-1',
    region: 'us-east-1',
    mode,
  };
}

test('registry rejects unknown service', () => {
  const registry = createDefaultExecutionAdapterRegistry(() => ({}));
  assert.throws(
    () => registry.resolve('unknown' as 'ec2'),
    ExecutionAdapterError,
  );
});

test('registry rejects unsupported action', () => {
  const registry = createDefaultExecutionAdapterRegistry(() => ({}));
  assert.equal(registry.isSupported('ec2', 'TERMINATE_INSTANCE'), false);
});

test('VALIDATION mode does not persist execution runs', async () => {
  const runs = new MockExecutionRunRepository();
  const orchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(() => ({}), {
      ec2: {
        service: 'ec2',
        supportedActions: () => ['START_INSTANCE'],
        validate: async () => ({ valid: true, checks: ['ok'] }),
        buildDryRunPlan: () => ({
          service: 'ec2',
          action: 'START_INSTANCE',
          resourceId: 'i-1',
          region: 'us-east-1',
          steps: [],
          reversible: true,
        }),
        capturePreviousConfiguration: async () => ({}),
        execute: async () => ({ success: true, message: 'no' }),
        verify: async () => ({ verified: true, checks: [] }),
        rollback: async () => ({ success: true, message: 'no' }),
        isRollbackEligible: () => ({ eligible: true }),
      },
    }),
    runs,
  });

  const result = await orchestrator.run(baseContext(EXECUTION_MODES.VALIDATION), {
    service: 'ec2',
    action: 'START_INSTANCE',
    resourceId: 'i-1',
  });

  assert.equal(result.status, 'VALIDATED');
  assert.equal(await runs.getById('tenant-a', result.runId), undefined);
});

test('DRY_RUN mode does not persist execution runs', async () => {
  const runs = new MockExecutionRunRepository();
  const orchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(() => ({}), {
      ec2: {
        service: 'ec2',
        supportedActions: () => ['START_INSTANCE'],
        validate: async () => ({ valid: true, checks: [] }),
        buildDryRunPlan: () => ({
          service: 'ec2',
          action: 'START_INSTANCE',
          resourceId: 'i-1',
          region: 'us-east-1',
          steps: ['plan'],
          reversible: true,
        }),
        capturePreviousConfiguration: async () => ({}),
        execute: async () => ({ success: true, message: 'no' }),
        verify: async () => ({ verified: true, checks: [] }),
        rollback: async () => ({ success: true, message: 'no' }),
        isRollbackEligible: () => ({ eligible: true }),
      },
    }),
    runs,
  });

  const result = await orchestrator.run(baseContext(EXECUTION_MODES.DRY_RUN), {
    service: 'ec2',
    action: 'START_INSTANCE',
    resourceId: 'i-1',
  });

  assert.equal(result.status, 'PLANNED');
  assert.ok(result.dryRunPlan);
  assert.equal(await runs.getById('tenant-a', result.runId), undefined);
});

test('PRODUCTION runs lifecycle and persists success', async () => {
  const calls: string[] = [];
  const runs = new MockExecutionRunRepository();
  const orchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(() => ({}), {
      ec2: {
        service: 'ec2',
        supportedActions: () => ['START_INSTANCE'],
        validate: async () => {
          calls.push('validate');
          return { valid: true, checks: [] };
        },
        buildDryRunPlan: () => ({
          service: 'ec2',
          action: 'START_INSTANCE',
          resourceId: 'i-1',
          region: 'us-east-1',
          steps: [],
          reversible: true,
        }),
        capturePreviousConfiguration: async () => {
          calls.push('snapshot');
          return { state: 'stopped' };
        },
        execute: async () => {
          calls.push('execute');
          return { success: true, message: 'ok' };
        },
        verify: async () => {
          calls.push('verify');
          return { verified: true, checks: [] };
        },
        rollback: async () => ({ success: true, message: 'rb' }),
        isRollbackEligible: () => ({ eligible: true }),
      },
    }),
    runs,
  });

  const result = await orchestrator.run(baseContext(EXECUTION_MODES.PRODUCTION), {
    service: 'ec2',
    action: 'START_INSTANCE',
    resourceId: 'i-1',
  });

  assert.deepEqual(calls, ['validate', 'snapshot', 'execute', 'verify']);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.tenantId, 'tenant-a');
  const persisted = await runs.getById('tenant-a', result.runId);
  assert.equal(persisted?.status, 'SUCCEEDED');
});

test('failed verification triggers rollback and preserves errors', async () => {
  const runs = new MockExecutionRunRepository();
  const orchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(() => ({}), {
      ec2: {
        service: 'ec2',
        supportedActions: () => ['START_INSTANCE'],
        validate: async () => ({ valid: true, checks: [] }),
        buildDryRunPlan: () => ({
          service: 'ec2',
          action: 'START_INSTANCE',
          resourceId: 'i-1',
          region: 'us-east-1',
          steps: [],
          reversible: true,
        }),
        capturePreviousConfiguration: async () => ({ state: 'stopped' }),
        execute: async () => ({ success: true, message: 'ok' }),
        verify: async () => ({
          verified: false,
          checks: [],
          error: {
            code: 'VERIFY_FAILED',
            message: 'verify failed',
            stage: 'verify',
          },
        }),
        rollback: async () => ({
          success: false,
          message: 'rollback failed',
          error: {
            code: 'ROLLBACK_FAILED',
            message: 'rollback failed',
            stage: 'rollback',
          },
        }),
        isRollbackEligible: () => ({ eligible: true }),
      },
    }),
    runs,
  });

  const result = await orchestrator.run(baseContext(EXECUTION_MODES.PRODUCTION), {
    service: 'ec2',
    action: 'START_INSTANCE',
    resourceId: 'i-1',
  });

  assert.equal(result.status, 'ROLLBACK_FAILED');
  assert.equal(result.failure?.code, 'VERIFY_FAILED');
  assert.equal(result.rollbackFailure?.code, 'ROLLBACK_FAILED');
});

test('audit events include execution lifecycle names', () => {
  assert.equal(AUDIT_EVENTS.EXECUTION_STARTED, 'execution.started');
  assert.equal(AUDIT_EVENTS.ROLLBACK_COMPLETED, 'rollback.completed');
});
