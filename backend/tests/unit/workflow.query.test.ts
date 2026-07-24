import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWorkflowListQuery,
  WorkflowListQueryValidationError,
} from '../../orchestrator/workflow.query';
import { WORKFLOW_STATES } from '../../shared/constants';

describe('parseWorkflowListQuery', () => {
  it('defaults limit and omits optional fields', () => {
    const query = parseWorkflowListQuery({});
    assert.equal(query.limit, 25);
    assert.equal(query.nextToken, undefined);
    assert.equal(query.status, undefined);
  });

  it('parses limit, nextToken, and status', () => {
    const query = parseWorkflowListQuery({
      limit: '10',
      nextToken: 'opaque-token',
      status: WORKFLOW_STATES.COMPLETED,
    });
    assert.equal(query.limit, 10);
    assert.equal(query.nextToken, 'opaque-token');
    assert.equal(query.status, WORKFLOW_STATES.COMPLETED);
  });

  it('rejects invalid limit and status values', () => {
    assert.throws(
      () => parseWorkflowListQuery({ limit: '0' }),
      WorkflowListQueryValidationError
    );
    assert.throws(
      () => parseWorkflowListQuery({ limit: '101' }),
      WorkflowListQueryValidationError
    );
    assert.throws(
      () => parseWorkflowListQuery({ status: 'archived' }),
      WorkflowListQueryValidationError
    );
  });
});
