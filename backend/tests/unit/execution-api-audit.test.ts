import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIT_EVENTS } from '../../audit';
import { buildAuditEvent } from '../../audit/audit-logger';
import { toAuditRecord } from '../../audit/audit-query';
import {
  EXECUTION_RUN_AUDIT_RESOURCE_TYPE,
  buildExecutionApiAuditInput,
} from '../../api/execution-api-audit';

const actor = {
  authenticated: true,
  userId: 'auditor-1',
  email: 'auditor-1@example.com',
  roles: ['admin'] as import('../../auth').SisumRole[],
};

describe('Execution API audit payloads', () => {
  it('maps execute success identifiers to executionId, workflowId, and resource', () => {
    const input = buildExecutionApiAuditInput({
      eventName: AUDIT_EVENTS.EXECUTION_EXECUTED,
      outcome: 'success',
      requestId: 'req-exec',
      correlationId: 'corr-exec',
      actor,
      tenantId: 'tenant-a',
      action: 'execution.plan.execute',
      method: 'POST',
      path: '/execution/plans/exec-plan-1/execute',
      statusCode: 200,
      planId: 'exec-plan-1',
      workflowId: 'wf-audit-1',
      runId: 'run-audit-1',
      runRegion: 'us-east-1',
    });

    assert.equal(input.executionId, 'exec-plan-1');
    assert.equal(input.workflowId, 'wf-audit-1');
    assert.notEqual(input.workflowId, 'run-audit-1');
    assert.deepEqual(input.resource, {
      type: EXECUTION_RUN_AUDIT_RESOURCE_TYPE,
      id: 'run-audit-1',
      region: 'us-east-1',
    });

    const record = toAuditRecord({
      ...buildAuditEvent(input),
      eventId: 'audit-event-execute-success',
    });
    assert.equal(record.executionId, 'exec-plan-1');
    assert.equal(record.workflowId, 'wf-audit-1');
    assert.equal(record.resourceType, EXECUTION_RUN_AUDIT_RESOURCE_TYPE);
    assert.equal(record.resourceId, 'run-audit-1');
    assert.equal(record.region, 'us-east-1');
  });

  it('maps execute failure without a run on resource fields', () => {
    const input = buildExecutionApiAuditInput({
      eventName: AUDIT_EVENTS.EXECUTION_EXECUTION_FAILED,
      outcome: 'failure',
      requestId: 'req-exec-fail',
      correlationId: 'corr-exec-fail',
      actor,
      tenantId: 'tenant-a',
      action: 'execution.plan.execute',
      method: 'POST',
      path: '/execution/plans/exec-plan-2/execute',
      statusCode: 409,
      planId: 'exec-plan-2',
      errorCode: 'CONFLICT',
    });

    assert.equal(input.executionId, 'exec-plan-2');
    assert.equal(input.workflowId, undefined);
    assert.equal(input.resource, undefined);
  });

  it('maps rollback requested and success with run resource', () => {
    for (const eventName of [
      AUDIT_EVENTS.EXECUTION_ROLLBACK_REQUESTED,
      AUDIT_EVENTS.EXECUTION_ROLLED_BACK,
    ]) {
      const input = buildExecutionApiAuditInput({
        eventName,
        outcome: eventName === AUDIT_EVENTS.EXECUTION_ROLLBACK_REQUESTED
          ? 'started'
          : 'success',
        requestId: 'req-rb',
        correlationId: 'corr-rb',
        actor,
        tenantId: 'tenant-a',
        action: 'execution.plan.rollback',
        method: 'POST',
        path: '/execution/plans/exec-plan-3/rollback',
        statusCode: 200,
        planId: 'exec-plan-3',
        workflowId: 'wf-audit-3',
        runId: 'run-audit-3',
      });

      assert.equal(input.executionId, 'exec-plan-3');
      assert.equal(input.workflowId, 'wf-audit-3');
      assert.equal(input.resource?.type, EXECUTION_RUN_AUDIT_RESOURCE_TYPE);
      assert.equal(input.resource?.id, 'run-audit-3');
    }
  });

  it('maps rollback failure to plan executionId only', () => {
    const input = buildExecutionApiAuditInput({
      eventName: AUDIT_EVENTS.EXECUTION_ROLLBACK_FAILED,
      outcome: 'failure',
      requestId: 'req-rb-fail',
      correlationId: 'corr-rb-fail',
      actor,
      tenantId: 'tenant-a',
      action: 'execution.plan.rollback',
      method: 'POST',
      path: '/execution/plans/exec-plan-4/rollback',
      statusCode: 409,
      planId: 'exec-plan-4',
      errorCode: 'EXECUTION_ROLLBACK_FAILED',
    });

    assert.equal(input.executionId, 'exec-plan-4');
    assert.equal(input.workflowId, undefined);
    assert.equal(input.resource, undefined);
  });
});
