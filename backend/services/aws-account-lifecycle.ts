import type {
  AwsAccountStatus,
  AwsAccountVerificationStatus,
} from '../repositories/models/aws-account-persistence-models';

const ALLOWED_TRANSITIONS: Record<
  AwsAccountStatus,
  readonly AwsAccountStatus[]
> = {
  PENDING: ['VALIDATING', 'DELETED'],
  VALIDATING: ['VERIFIED', 'PENDING', 'SUSPENDED', 'DELETED'],
  VERIFIED: ['VALIDATING', 'SUSPENDED', 'DELETED'],
  SUSPENDED: ['VALIDATING', 'VERIFIED', 'DELETED'],
  DELETED: [],
};

export class InvalidAwsAccountTransitionError extends Error {
  constructor(from: AwsAccountStatus, to: AwsAccountStatus) {
    super(`AWS account cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidAwsAccountTransitionError';
  }
}

export class InvalidAwsAccountStatusConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAwsAccountStatusConsistencyError';
  }
}

export function validateAwsAccountTransition(
  from: AwsAccountStatus,
  to: AwsAccountStatus,
): void {
  if (from === to) {
    throw new InvalidAwsAccountTransitionError(from, to);
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidAwsAccountTransitionError(from, to);
  }
}

export function verificationFieldsForValidationStart(): {
  verificationStatus: AwsAccountVerificationStatus;
} {
  return { verificationStatus: 'IN_PROGRESS' };
}

export function verificationFieldsForValidationSuccess(
  validatedAt: string,
): {
  verificationStatus: AwsAccountVerificationStatus;
  lastValidated: string;
} {
  return {
    verificationStatus: 'SUCCEEDED',
    lastValidated: validatedAt,
  };
}

export function verificationFieldsForValidationFailure(
  failedAt: string,
): {
  verificationStatus: AwsAccountVerificationStatus;
  lastValidated: string;
} {
  return {
    verificationStatus: 'FAILED',
    lastValidated: failedAt,
  };
}

export function validateAwsAccountStatusConsistency(input: {
  status: AwsAccountStatus;
  verificationStatus: AwsAccountVerificationStatus;
  lastValidated?: string;
}): void {
  const { status, verificationStatus, lastValidated } = input;

  if (status === 'DELETED' && verificationStatus === 'IN_PROGRESS') {
    throw new InvalidAwsAccountStatusConsistencyError(
      'DELETED accounts cannot be IN_PROGRESS.',
    );
  }

  if (status === 'PENDING' && verificationStatus === 'IN_PROGRESS') {
    throw new InvalidAwsAccountStatusConsistencyError(
      'PENDING accounts cannot be IN_PROGRESS.',
    );
  }

  if (status === 'VALIDATING' && verificationStatus !== 'IN_PROGRESS') {
    throw new InvalidAwsAccountStatusConsistencyError(
      'VALIDATING accounts must use IN_PROGRESS verification status.',
    );
  }

  if (status === 'VERIFIED' && verificationStatus !== 'SUCCEEDED') {
    throw new InvalidAwsAccountStatusConsistencyError(
      'VERIFIED accounts must use SUCCEEDED verification status.',
    );
  }

  if (lastValidated !== undefined && verificationStatus === 'NOT_STARTED') {
    throw new InvalidAwsAccountStatusConsistencyError(
      'lastValidated requires verification progress beyond NOT_STARTED.',
    );
  }

  if (
    lastValidated !== undefined &&
    verificationStatus !== 'SUCCEEDED' &&
    verificationStatus !== 'FAILED' &&
    verificationStatus !== 'IN_PROGRESS'
  ) {
    throw new InvalidAwsAccountStatusConsistencyError(
      'lastValidated is only valid after a completed validation attempt or while validation is in progress.',
    );
  }
}

export const AWS_ACCOUNT_ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
