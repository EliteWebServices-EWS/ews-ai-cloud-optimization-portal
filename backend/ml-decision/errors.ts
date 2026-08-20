export class MlDecisionScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlDecisionScopeError';
  }
}
