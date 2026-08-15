import { CONFIDENCE_FORMULA_VERSION } from '../../../engines/confidence';
import { CONFIDENCE_STATUS } from '../../../shared/constants';
import type { ConfidenceFactor, ConfidenceResult } from '../../../shared/types';

export function buildConfidenceResult(
  overrides: Partial<ConfidenceResult> = {},
): ConfidenceResult {
  const base: ConfidenceResult = {
    score: 85,
    status: CONFIDENCE_STATUS.HIGH,
    reason: 'Stable utilization pattern',
    factors: [] as ConfidenceFactor[],
    formulaVersion: CONFIDENCE_FORMULA_VERSION,
    level: 'high',
  };
  return structuredClone({ ...base, ...overrides });
}

export function buildGoldenCompleteConfidenceResult(): ConfidenceResult {
  return buildConfidenceResult({
    score: 100,
    status: CONFIDENCE_STATUS.HIGH,
    reason: 'High confidence (100) — stable workload over observation period',
    level: 'high',
  });
}
