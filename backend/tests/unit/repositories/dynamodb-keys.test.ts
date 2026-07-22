import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OWNERSHIP_SORT_KEY,
  createdAtIndexSortKey,
  learningSortKey,
  ownershipPartitionKey,
  reportSortKey,
  tenantPartitionKey,
  verificationSortKey,
  workflowResourceIndexPartitionKey,
  workflowSortKey,
  workflowStatusIndexPartitionKey,
} from '../../../database/dynamodb-keys';

describe('DynamoDB key helpers', () => {
  it('creates a tenant partition key', () => {
    assert.equal(
      tenantPartitionKey('tenant-a'),
      'TENANT#tenant-a',
    );
  });

  it('creates a workflow sort key', () => {
    assert.equal(
      workflowSortKey('wf-123'),
      'WORKFLOW#wf-123',
    );
  });

  it('creates a report sort key', () => {
    assert.equal(
      reportSortKey('report-123'),
      'REPORT#report-123',
    );
  });

  it('creates a learning sort key', () => {
    assert.equal(
      learningSortKey('learning-123'),
      'LEARNING#learning-123',
    );
  });

  it('creates a verification sort key', () => {
    assert.equal(
      verificationSortKey('verification-123'),
      'VERIFICATION#verification-123',
    );
  });

  it('creates an ownership partition key', () => {
    assert.equal(
      ownershipPartitionKey('WORKFLOW', 'wf-123'),
      'RESOURCE#WORKFLOW#wf-123',
    );
  });

  it('uses the fixed ownership sort key', () => {
    assert.equal(OWNERSHIP_SORT_KEY, 'OWNERSHIP');
  });

  it('creates a workflow status index partition key', () => {
    assert.equal(
      workflowStatusIndexPartitionKey(
        'tenant-a',
        'COMPLETED',
      ),
      'TENANT#tenant-a#WORKFLOW_STATUS#COMPLETED',
    );
  });

  it('creates a workflow resource index partition key', () => {
    assert.equal(
      workflowResourceIndexPartitionKey(
        'tenant-a',
        'wf-123',
      ),
      'TENANT#tenant-a#WORKFLOW#wf-123',
    );
  });

  it('creates a chronological index sort key', () => {
    assert.equal(
      createdAtIndexSortKey(
        '2026-07-22T10:00:00.000Z',
        'REPORT',
        'report-123',
      ),
      'CREATED_AT#2026-07-22T10:00:00.000Z#REPORT#report-123',
    );
  });

  it('removes surrounding whitespace from identifiers', () => {
    assert.equal(
      tenantPartitionKey(' tenant-a '),
      'TENANT#tenant-a',
    );
  });

  it('rejects an empty tenant ID', () => {
    assert.throws(
      () => tenantPartitionKey(''),
      /tenantId must not be empty/,
    );
  });

  it('rejects an empty resource ID', () => {
    assert.throws(
      () => workflowSortKey('   '),
      /resourceId must not be empty/,
    );
  });

  it('rejects identifiers containing the key separator', () => {
    assert.throws(
      () => tenantPartitionKey('tenant#a'),
      /tenantId must not contain #/,
    );
  });
});