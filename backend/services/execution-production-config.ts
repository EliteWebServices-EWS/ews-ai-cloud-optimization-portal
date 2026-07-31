import { PROVIDER_NAMES } from '../shared/constants';

/**
 * Live AWS adapter execution (ExecutionOrchestrator PRODUCTION mode) requires
 * explicit opt-in. The HTTP API fails closed when this is false.
 */
export function isAdapterProductionExecutionEnabled(): boolean {
  const flag = process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED?.trim().toLowerCase();
  if (flag !== 'true') {
    return false;
  }

  const providerMode = (process.env.PROVIDER_MODE ?? PROVIDER_NAMES.MOCK).toLowerCase();
  return providerMode === PROVIDER_NAMES.AWS;
}
