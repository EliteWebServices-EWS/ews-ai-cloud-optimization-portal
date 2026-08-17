export class EvidenceMaturityEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceMaturityEvaluationError';
  }
}

export class EvidenceMaturityPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceMaturityPersistenceError';
  }
}
