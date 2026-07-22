import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageSize,
} from '../../../repositories/contracts/repository-types';

describe('Repository pagination types', () => {
  it('uses the default page size when no limit is provided', () => {
    assert.equal(
      normalizePageSize(undefined),
      DEFAULT_PAGE_SIZE,
    );
  });

  it('accepts a valid page size', () => {
    assert.equal(normalizePageSize(50), 50);
  });

  it('caps a large page size at the maximum', () => {
    assert.equal(normalizePageSize(500), MAX_PAGE_SIZE);
  });

  it('rejects zero', () => {
    assert.throws(
      () => normalizePageSize(0),
      /positive integer/,
    );
  });

  it('rejects a negative number', () => {
    assert.throws(
      () => normalizePageSize(-1),
      /positive integer/,
    );
  });

  it('rejects decimal values', () => {
    assert.throws(
      () => normalizePageSize(1.5),
      /positive integer/,
    );
  });
});