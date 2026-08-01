import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withRetry, withTimeout } from '../../execution/adapters/sts/retry';

function noDelay(): (ms: number) => Promise<void> {
  const calls: number[] = [];
  const fn = async (ms: number) => {
    calls.push(ms);
  };
  (fn as unknown as { calls: number[] }).calls = calls;
  return fn;
}

describe('withRetry', () => {
  it('returns immediately on first success without delaying', async () => {
    const delay = noDelay();
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, isRetryable: () => true, delay },
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 1);
    assert.deepEqual((delay as unknown as { calls: number[] }).calls, []);
  });

  it('retries retryable errors up to maxAttempts then succeeds', async () => {
    const delay = noDelay();
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('transient');
        }
        return 'ok';
      },
      { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 100, isRetryable: () => true, delay },
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
    assert.equal((delay as unknown as { calls: number[] }).calls.length, 2);
  });

  it('throws immediately for a non-retryable error without retrying', async () => {
    const delay = noDelay();
    let attempts = 0;

    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts += 1;
            throw new Error('permanent');
          },
          { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 100, isRetryable: () => false, delay },
        ),
      /permanent/,
    );

    assert.equal(attempts, 1);
  });

  it('throws the last error once maxAttempts is exhausted', async () => {
    const delay = noDelay();
    let attempts = 0;

    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts += 1;
            throw new Error(`fail-${attempts}`);
          },
          { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, isRetryable: () => true, delay },
        ),
      /fail-3/,
    );

    assert.equal(attempts, 3);
  });

  it('caps backoff delay at maxDelayMs', async () => {
    const observedDelays: number[] = [];
    const delay = async (ms: number) => {
      observedDelays.push(ms);
    };
    let attempts = 0;

    await assert.rejects(() =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('always fails');
        },
        { maxAttempts: 6, baseDelayMs: 1000, maxDelayMs: 50, isRetryable: () => true, delay },
      ),
    );

    for (const observed of observedDelays) {
      assert.ok(observed <= 50, `expected delay <= 50ms, got ${observed}`);
    }
  });
});

describe('withTimeout', () => {
  it('resolves normally when the operation finishes before the timeout', async () => {
    const result = await withTimeout(
      async () => 'done',
      1000,
      () => new Error('should not time out'),
    );
    assert.equal(result, 'done');
  });

  it('rejects with the timeout error when the operation hangs', async () => {
    await assert.rejects(
      () =>
        withTimeout(
          () => new Promise(() => {}), // never resolves
          20,
          () => new Error('operation timed out'),
        ),
      /operation timed out/,
    );
  });

  it('propagates a non-timeout error unchanged', async () => {
    await assert.rejects(
      () =>
        withTimeout(
          async () => {
            throw new Error('real failure');
          },
          1000,
          () => new Error('should not time out'),
        ),
      /real failure/,
    );
  });
});
