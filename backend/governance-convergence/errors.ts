export class GovernanceConvergenceDataQualityError extends Error {
  readonly code = 'GOVERNANCE_CONVERGENCE_DATA_QUALITY_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'GovernanceConvergenceDataQualityError';
  }
}
