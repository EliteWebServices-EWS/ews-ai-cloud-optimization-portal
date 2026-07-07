import type { ProviderInterface } from '../shared/interfaces';
import { PROVIDER_NAMES, type ProviderName } from '../shared/constants';
import { createMockProvider } from './mock';
import { createAwsProvider } from './aws';

export type { ProviderInterface } from '../shared/interfaces';
export { MockProvider, createMockProvider } from './mock';
export { AwsProvider, createAwsProvider } from './aws';

/** Factory for creating provider instances by name. */
export function createProvider(name: ProviderName): ProviderInterface {
  if (name === PROVIDER_NAMES.MOCK) {
    return createMockProvider();
  }
  if (name === PROVIDER_NAMES.AWS) {
    return createAwsProvider();
  }
  throw new Error(`Unknown provider: ${name}`);
}

/** List all registered provider names. */
export function listProviders(): ProviderName[] {
  return [PROVIDER_NAMES.MOCK, PROVIDER_NAMES.AWS];
}
