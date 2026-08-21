import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Sprint 4 provenance repository safety', () => {
  it('decision reconstruction service does not use DynamoDB Scan', () => {
    const servicePath = resolve(
      process.cwd(),
      'services/decision-provenance-reconstruction-service.ts',
    );
    const source = readFileSync(servicePath, 'utf8');
    assert.doesNotMatch(source, /\bScanCommand\b/);
    assert.doesNotMatch(source, /\bscan\s*\(/i);
  });

  it('dynamodb action log repository uses Query not Scan', () => {
    const repoPath = resolve(
      process.cwd(),
      'repositories/dynamodb/dynamodb-action-log-repository.ts',
    );
    const source = readFileSync(repoPath, 'utf8');
    assert.match(source, /QueryCommand/);
    assert.doesNotMatch(source, /\bScanCommand\b/);
  });
});
