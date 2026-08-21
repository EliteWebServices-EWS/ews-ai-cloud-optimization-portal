import type { ActionLogRecord } from '../action-log/types';

const EXECUTION_EVENT_TYPES = new Set([
  'EXECUTION_STARTED',
  'EXECUTION_SUCCEEDED',
  'EXECUTION_FAILED',
  'EXECUTION_SIMULATED',
]);

export function isSimulationPath(events: readonly ActionLogRecord[]): boolean {
  return events.some((event) => event.eventType === 'EXECUTION_SIMULATED');
}

export function requiresApproval(events: readonly ActionLogRecord[]): boolean {
  if (isSimulationPath(events)) {
    return false;
  }
  if (events.some((event) => event.eventType === 'APPROVAL_REQUIRED')) {
    return true;
  }
  return events.some((event) => EXECUTION_EVENT_TYPES.has(event.eventType));
}

export function requiresVerification(events: readonly ActionLogRecord[]): boolean {
  if (isSimulationPath(events)) {
    return false;
  }
  return events.some(
    (event) =>
      event.eventType === 'EXECUTION_SUCCEEDED' ||
      event.eventType === 'EXECUTION_FAILED',
  );
}

export function requiresExecution(events: readonly ActionLogRecord[]): boolean {
  return !isSimulationPath(events) && requiresVerification(events);
}
