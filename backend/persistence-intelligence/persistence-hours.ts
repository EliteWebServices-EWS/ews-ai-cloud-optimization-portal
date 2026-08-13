import { PersistenceDataQualityError } from './errors';
import { parseObservationTimestamp } from './timestamp-rules';

export function computePersistenceHours(input: {
  currentObservationTimestamp: string;
  previousObservationTimestamp?: string | null;
}): number | null {
  if (!input.previousObservationTimestamp) {
    return null;
  }
  const current = parseObservationTimestamp(input.currentObservationTimestamp);
  const previous = parseObservationTimestamp(input.previousObservationTimestamp);
  const deltaMs = current.epochMs - previous.epochMs;
  if (deltaMs < 0) {
    throw new PersistenceDataQualityError(
      'Negative persistence duration is not allowed for ordered observations.',
    );
  }
  return deltaMs / (1000 * 60 * 60);
}
