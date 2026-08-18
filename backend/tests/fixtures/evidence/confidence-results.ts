import { CONFIDENCE_FORMULA_VERSION, CONFIDENCE_MODEL_VERSION } from '../../../engines/confidence';
import { CONFIDENCE_STATUS } from '../../../shared/constants';
import type { ConfidenceFactor, ConfidenceResult } from '../../../shared/types';

export function buildConfidenceResult(
  overrides: Partial<ConfidenceResult> = {},
): ConfidenceResult {
  const score = overrides.score ?? overrides.commercialScore ?? 85;
  const status = overrides.status ?? CONFIDENCE_STATUS.HIGH;
  const base: ConfidenceResult = {
    score,
    commercialScore: overrides.commercialScore ?? score,
    status,
    reason: 'Stable utilization pattern',
    factors: [] as ConfidenceFactor[],
    formulaVersion: CONFIDENCE_FORMULA_VERSION,
    confidenceModelVersion: CONFIDENCE_MODEL_VERSION,
    reasonCodes: [],
    level: status === CONFIDENCE_STATUS.HIGH ? 'high' : status === CONFIDENCE_STATUS.MEDIUM ? 'medium' : 'low',
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
