import { RECOMMENDATION_STATUS } from '../shared/constants';

/** Configuration for the mock execution simulator. */
export interface ExecutionSimulatorConfig {
  /** Recommendation statuses eligible for simulated execution. */
  executableStatuses: string[];
  /** Simulated execution delay in milliseconds (logged only in demo mode). */
  simulatedDelayMs: number;
}

export const DEFAULT_EXECUTION_CONFIG: ExecutionSimulatorConfig = {
  executableStatuses: [RECOMMENDATION_STATUS.RECOMMENDED],
  simulatedDelayMs: 0,
};
