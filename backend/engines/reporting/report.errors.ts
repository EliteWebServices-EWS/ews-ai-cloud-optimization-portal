/**
 * Report generation errors — structured failures for the Reporting Engine.
 */

import type { EngineError } from '../../shared/types';

export const REPORT_ERROR_CODES = {
  MISSING_WORKFLOW: 'MISSING_WORKFLOW',
  INVALID_REPORT_DATA: 'INVALID_REPORT_DATA',
  REPORT_GENERATION_FAILED: 'REPORT_GENERATION_FAILED',
  INCOMPLETE_OPTIMIZATION: 'INCOMPLETE_OPTIMIZATION',
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
} as const;

export function createReportError(
  code: string,
  reason: string,
  recovery?: string
): EngineError {
  return {
    engine: 'Reporting Engine',
    code,
    reason,
    recovery,
  };
}
