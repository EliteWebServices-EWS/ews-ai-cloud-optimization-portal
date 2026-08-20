export class PostActionVerificationScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostActionVerificationScopeError';
  }
}
