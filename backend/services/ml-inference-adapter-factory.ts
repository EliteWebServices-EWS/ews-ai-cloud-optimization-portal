import {
  MockMlInferenceAdapter,
  type MockMlInferenceAdapterOptions,
  UnavailableMlInferenceAdapter,
} from '../ml-decision/adapters/mock-ml-inference-adapter';
import type { MlInferenceAdapter } from '../ml-decision/adapters/ml-inference-adapter';

export type MlInferenceAdapterMode = 'unavailable' | 'mock';

export function createMlInferenceAdapter(
  mode: MlInferenceAdapterMode = 'unavailable',
  options?: MockMlInferenceAdapterOptions,
): MlInferenceAdapter {
  if (mode === 'mock') {
    return new MockMlInferenceAdapter(options);
  }

  return new UnavailableMlInferenceAdapter();
}
