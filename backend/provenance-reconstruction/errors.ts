export class ProvenanceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceScopeError';
  }
}

export class ProvenanceReconstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceReconstructionError';
  }
}
