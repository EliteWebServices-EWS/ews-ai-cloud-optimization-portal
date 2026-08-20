import { ML_MODEL_CONTRACT_VERSION } from '../model-version';
import type {
  MlInferenceAdapter,
  MlInferenceAdapterResult,
  MlInferenceRequest,
} from './ml-inference-adapter';

export class UnavailableMlInferenceAdapter implements MlInferenceAdapter {
  async infer(_request: MlInferenceRequest): Promise<MlInferenceAdapterResult> {
    return {
      status: 'UNAVAILABLE',
      errorCode: 'MODEL_UNAVAILABLE',
    };
  }
}

export interface MockMlInferenceAdapterOptions {
  confidence?: number;
  unavailable?: boolean;
  throwOnInfer?: boolean;
  corruptOutput?: boolean;
}

export class MockMlInferenceAdapter implements MlInferenceAdapter {
  constructor(private readonly options: MockMlInferenceAdapterOptions = {}) {}

  async infer(request: MlInferenceRequest): Promise<MlInferenceAdapterResult> {
    if (this.options.throwOnInfer) {
      throw new Error('Simulated inference failure.');
    }

    if (this.options.unavailable) {
      return {
        status: 'UNAVAILABLE',
        errorCode: 'MODEL_UNAVAILABLE',
      };
    }

    if (this.options.corruptOutput) {
      return {
        status: 'AVAILABLE',
        raw: {
          modelId: request.modelId ?? 'mock-model',
          modelVersion: request.modelVersion ?? 'mock-v1',
          featureSchemaVersion: 'invalid-schema',
          modelConfidence: Number.NaN,
        },
      };
    }

    return {
      status: 'AVAILABLE',
      raw: {
        modelId: request.modelId ?? 'mock-model',
        modelVersion: request.modelVersion ?? 'mock-v1',
        featureSchemaVersion: request.featureSchemaVersion ?? ML_MODEL_CONTRACT_VERSION,
        modelConfidence: this.options.confidence ?? 0.82,
        contribution: {
          recommendationId: request.recommendationId,
          rankingDelta: 0.12,
        },
      },
    };
  }
}
