/** Frozen Sprint 3 ML eligibility policy version. */
export const ML_ELIGIBILITY_POLICY_VERSION = 'ml-eligibility-v1';

/** Supported production model contract version for inference validation. */
export const ML_MODEL_CONTRACT_VERSION = 'ml-model-contract-v1';

/** Minimum stable-epoch observations required before ML eligibility (explicit policy constant). */
export const ML_MIN_STABLE_EPOCH_OBSERVATIONS = 2;

/** Minimum validated model confidence required to treat inference as EXECUTED. */
export const ML_MIN_EXECUTED_CONFIDENCE = 0.5;

/** Maximum accepted length for model identity / schema version strings. */
export const ML_MAX_IDENTITY_LENGTH = 128;

/** Maximum JSON size for untrusted contribution metadata. */
export const ML_MAX_CONTRIBUTION_JSON_BYTES = 4096;

/** Maximum nesting depth for untrusted contribution metadata. */
export const ML_MAX_CONTRIBUTION_DEPTH = 4;
