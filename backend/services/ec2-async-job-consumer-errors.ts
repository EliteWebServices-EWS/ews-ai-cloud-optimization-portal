export class Ec2AsyncJobConsumerRetryableError extends Error {
  constructor(message = 'Retryable EC2 async job processing failure.') {
    super(message);
    this.name = 'Ec2AsyncJobConsumerRetryableError';
  }
}

export class Ec2AsyncJobConsumerTerminalError extends Error {
  readonly safeSummary: string;

  constructor(safeSummary: string) {
    super(safeSummary);
    this.name = 'Ec2AsyncJobConsumerTerminalError';
    this.safeSummary = safeSummary;
  }
}

export function sanitizeConsumerErrorSummary(error: unknown): string {
  if (error instanceof Ec2AsyncJobConsumerTerminalError) {
    return error.safeSummary;
  }
  if (error instanceof Error && error.name) {
    return `${error.name}: processing failed.`;
  }
  return 'EC2 async job processing failed.';
}

export function isRetryableConsumerError(error: unknown): boolean {
  return error instanceof Ec2AsyncJobConsumerRetryableError;
}
