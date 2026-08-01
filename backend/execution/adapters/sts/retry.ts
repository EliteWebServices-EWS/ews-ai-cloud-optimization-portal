/**
 * Generic exponential-backoff retry helper. The delay function is injectable
 * so tests can assert retry counts and error classification deterministically
 * without real sleeps or flaky timing.
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  isRetryable: (error: unknown) => boolean;
  delay?: (ms: number) => Promise<void>;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  // Full jitter (AWS-recommended): random value in [0, capped].
  return Math.random() * capped;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const delay = options.delay ?? defaultDelay;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === options.maxAttempts;
      if (isLastAttempt || !options.isRetryable(error)) {
        throw error;
      }

      await delay(
        backoffDelayMs(attempt, options.baseDelayMs, options.maxDelayMs),
      );
    }
  }

  throw lastError;
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;

  // A race against a timer is required, not just AbortSignal: passing the
  // signal lets cooperative callers (like the AWS SDK's HTTP handler) cancel
  // promptly, but nothing guarantees the callee honors it. Without the race,
  // a callee that ignores the signal — or a network layer that swallows the
  // abort — would hang this call forever, defeating the whole point of a
  // timeout.
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(onTimeout());
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
