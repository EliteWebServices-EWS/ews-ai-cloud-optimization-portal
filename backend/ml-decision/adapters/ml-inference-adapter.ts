import type { MlFeatureManifest } from '../types';

export interface MlInferenceRequest {
  tenantId: string;
  accountId: string;
  correlationId: string;
  recommendationId: string;
  findingKey: string;
  resourceId: string;
  evaluationId: string;
  featureSchemaVersion: string | null;
  featureManifest: MlFeatureManifest;
  modelId: string | null;
  modelVersion: string | null;
}

export type MlInferenceAdapterStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface MlInferenceAdapterResult {
  status: MlInferenceAdapterStatus;
  /** Untrusted vendor/model payload — validated before use. */
  raw?: unknown;
  errorCode?: string;
}

/**
 * Vendor-neutral ML inference boundary.
 * Must not import execution orchestrators, approval lifecycle, or AWS mutation adapters.
 */
export interface MlInferenceAdapter {
  infer(request: MlInferenceRequest): Promise<MlInferenceAdapterResult>;
}
