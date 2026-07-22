import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InvalidPaginationTokenError,
  decodeNextToken,
  encodeNextToken,
} from '../../../database/pagination-token';

describe('DynamoDB pagination tokens', () => {
  it('encodes and decodes a DynamoDB key', () => {
    const key = {
      pk: 'TENANT#tenant-a',
      sk: 'WORKFLOW#wf-123',
    };

    const token = encodeNextToken(key);

    assert.ok(token);
    assert.deepEqual(decodeNextToken(token), key);
  });

  it('returns undefined when no key is supplied', () => {
    assert.equal(encodeNextToken(undefined), undefined);
  });

  it('returns undefined when no token is supplied', () => {
    assert.equal(decodeNextToken(undefined), undefined);
  });

  it('creates a URL-safe token', () => {
    const token = encodeNextToken({
      pk: 'TENANT#tenant-a',
      sk: 'REPORT#report-123',
    });

    assert.ok(token);
    assert.equal(token.includes('+'), false);
    assert.equal(token.includes('/'), false);
    assert.equal(token.includes('='), false);
  });

  it('rejects malformed tokens', () => {
    assert.throws(
      () => decodeNextToken('not-a-valid-token'),
      InvalidPaginationTokenError,
    );
  });

  it('rejects tokens containing an array', () => {
    const token = Buffer.from(
      JSON.stringify(['invalid']),
      'utf8',
    ).toString('base64url');

    assert.throws(
      () => decodeNextToken(token),
      InvalidPaginationTokenError,
    );
  });

  it('rejects tokens containing a primitive value', () => {
    const token = Buffer.from(
      JSON.stringify('invalid'),
      'utf8',
    ).toString('base64url');

    assert.throws(
      () => decodeNextToken(token),
      InvalidPaginationTokenError,
    );
  });
});