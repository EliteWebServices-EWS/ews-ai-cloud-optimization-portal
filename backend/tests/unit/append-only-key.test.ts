import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAppendOnlyKeySuffix,
  compareAppendOnlySortKeys,
  extractAppendOnlySuffix,
} from '../../persistence/append-only-key';

describe('buildAppendOnlyKeySuffix', () => {
  it('builds timestamp#uuid without a discriminator', () => {
    const suffix = buildAppendOnlyKeySuffix('2026-07-27T20:00:00.000Z');
    assert.match(suffix, /^2026-07-27T20:00:00\.000Z#[0-9a-f-]{36}$/);
  });

  it('builds timestamp#discriminator#uuid when discriminator is provided', () => {
    const suffix = buildAppendOnlyKeySuffix('2026-07-27T20:00:00.000Z', '10');
    assert.match(suffix, /^2026-07-27T20:00:00\.000Z#10#[0-9a-f-]{36}$/);
  });

  it('rejects empty or hash-containing discriminators', () => {
    assert.throws(() => buildAppendOnlyKeySuffix('2026-07-27T20:00:00.000Z', ''), /non-empty/);
    assert.throws(() => buildAppendOnlyKeySuffix('2026-07-27T20:00:00.000Z', 'bad#value'), /must not contain/);
  });
});

describe('compareAppendOnlySortKeys', () => {
  const prefix = 'REPORTHIST#rpt-001#';

  it('orders legacy numeric suffixes numerically', () => {
    assert.ok(compareAppendOnlySortKeys(`${prefix}2`, `${prefix}10`) < 0);
    assert.ok(compareAppendOnlySortKeys(`${prefix}1`, `${prefix}2`) < 0);
  });

  it('orders timestamp keys chronologically', () => {
    const earlier = `${prefix}2026-07-27T20:00:00.000Z#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
    const later = `${prefix}2026-07-27T20:00:01.000Z#bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;
    assert.equal(compareAppendOnlySortKeys(earlier, later), -1);
  });

  it('orders same-millisecond lifecycle keys created -> updated -> deleted', () => {
    const ts = '2026-07-27T20:14:54.302Z';
    const created = `${prefix}${ts}#00#11111111-1111-1111-1111-111111111111`;
    const updated = `${prefix}${ts}#10#22222222-2222-2222-2222-222222222222`;
    const deleted = `${prefix}${ts}#20#33333333-3333-3333-3333-333333333333`;

    assert.equal(compareAppendOnlySortKeys(created, updated), -1);
    assert.equal(compareAppendOnlySortKeys(updated, deleted), -1);
    assert.equal(compareAppendOnlySortKeys(created, deleted), -1);
  });

  it('orders legacy timestamp#uuid keys without throwing', () => {
    const ts = '2026-07-27T20:14:54.302Z';
    const left = `${prefix}${ts}#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
    const right = `${prefix}${ts}#bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;
    assert.notEqual(compareAppendOnlySortKeys(left, right), 0);
  });

  it('extracts append-only suffix after resource id', () => {
    assert.equal(
      extractAppendOnlySuffix('REPORTHIST#rpt-001#2026-07-27T20:00:00.000Z#00#uuid'),
      '2026-07-27T20:00:00.000Z#00#uuid',
    );
    assert.equal(extractAppendOnlySuffix('REPORTHIST#rpt-001#3'), '3');
  });

  it('leaves learning confidence timestamp#uuid keys comparable', () => {
    const prefix = 'CONFIDENCEHIST#workflow-001#';
    const left = `${prefix}2026-07-27T20:00:00.000Z#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
    const right = `${prefix}2026-07-27T20:00:01.000Z#bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;
    assert.equal(compareAppendOnlySortKeys(left, right), -1);
  });
});
