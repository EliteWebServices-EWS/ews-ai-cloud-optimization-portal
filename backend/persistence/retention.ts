/** Workflow and ownership records share the workflow retention window. */
export const WORKFLOW_RETENTION_SECONDS = 90 * 24 * 60 * 60;

/** Report primary records and report history. */
export const REPORT_RETENTION_SECONDS = 180 * 24 * 60 * 60;

/** Learning records, feedback, and confidence history. */
export const LEARNING_RETENTION_SECONDS = 365 * 24 * 60 * 60;

/** Verification outputs and execution pointers. */
export const VERIFICATION_RETENTION_SECONDS = 180 * 24 * 60 * 60;

export function computeExpiresAt(
  retentionSeconds: number,
  nowMs = Date.now(),
): number {
  return Math.floor(nowMs / 1000) + retentionSeconds;
}
