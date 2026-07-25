import type {
  TenantStatus,
} from '../repositories/models/persistence-models';

const ALLOWED_TRANSITIONS: Record<
  TenantStatus,
  readonly TenantStatus[]
> = {
  PROVISIONING: ['ACTIVE', 'DELETED'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['DELETED'],
  DELETED: [],
};

export class InvalidTenantTransitionError extends Error {
  public constructor(
    currentStatus: TenantStatus,
    nextStatus: TenantStatus,
  ) {
    super(
      `Tenant cannot transition from ${currentStatus} to ${nextStatus}.`,
    );

    this.name = 'InvalidTenantTransitionError';
  }
}

export function validateTenantTransition(
  currentStatus: TenantStatus,
  nextStatus: TenantStatus,
): void {
  const allowedTransitions =
    ALLOWED_TRANSITIONS[currentStatus];

  if (!allowedTransitions.includes(nextStatus)) {
    throw new InvalidTenantTransitionError(
      currentStatus,
      nextStatus,
    );
  }
}