export class PersistenceDataQualityError extends Error {
  readonly code = 'PERSISTENCE_DATA_QUALITY_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PersistenceDataQualityError';
  }
}
