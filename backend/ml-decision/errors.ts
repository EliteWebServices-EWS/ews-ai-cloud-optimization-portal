export class MlDecisionScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlDecisionScopeError';
  }
}

export class MlInferenceTimeoutError extends Error {
  constructor(message = 'ML inference timed out.') {
    super(message);
    this.name = 'MlInferenceTimeoutError';
  }
}
