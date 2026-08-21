import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LEARNING_RETENTION_SECONDS,
  VERIFICATION_RETENTION_SECONDS,
  WORKFLOW_RETENTION_SECONDS,
} from '../../persistence/retention';
import * as retentionModule from '../../persistence/retention';

describe('Sprint 4 retention and evidence lineage constants', () => {
  it('documents shorter workflow retention than learning retention', () => {
    assert.ok(WORKFLOW_RETENTION_SECONDS < LEARNING_RETENTION_SECONDS);
  });

  it('documents verification retention window used by engine persistence', () => {
    assert.equal(VERIFICATION_RETENTION_SECONDS, 180 * 24 * 60 * 60);
  });

  it('ActionLog has no TTL constant in retention module — lineage gap risk is explicit', () => {
    assert.equal(
      (retentionModule as Record<string, unknown>).ACTION_LOG_RETENTION_SECONDS,
      undefined,
    );
  });
});
