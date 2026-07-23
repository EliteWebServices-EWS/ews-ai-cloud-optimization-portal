export {
  VerificationEngine,
  createVerificationEngine,
  compareVerificationOutcome,
  buildVerificationReport,
  DEFAULT_VERIFICATION_CONFIG,
} from './verification.engine';
export type { VerificationEngineOptions } from './verification.engine';
export type { VerificationConfig } from './verification.config';
export { MockVerificationRepository } from './mock-verification.repository';
export { DynamoDbVerificationRepository } from './dynamodb-verification.repository';
export type { VerificationOutput, VerificationRepository } from './verification.repository';
