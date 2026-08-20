/** Frozen Sprint 3 ML eligibility policy version. */
export const ML_ELIGIBILITY_POLICY_VERSION = 'ml-eligibility-v1';

/** Supported production model contract version for inference validation. */
export const ML_MODEL_CONTRACT_VERSION = 'ml-model-contract-v1';

/** Minimum stable-epoch observations required before ML eligibility (explicit policy constant). */
export const ML_MIN_STABLE_EPOCH_OBSERVATIONS = 2;

/** Minimum validated model confidence required to treat inference as EXECUTED. */
export const ML_MIN_EXECUTED_CONFIDENCE = 0.5;
