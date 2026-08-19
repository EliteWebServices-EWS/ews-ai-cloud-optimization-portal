export interface ActionLogLifecycleContext {
  tenantId: string;
  accountId: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  jobId?: string;
}

/**
 * Explicit decision scope for lifecycle reconstruction. Never inferred from
 * resourceId alone.
 */
export function resolveActionLogDecisionId(input: {
  correlationId: string;
  findingKey: string;
  recommendationId: string;
  decisionId?: string;
}): string {
  return input.decisionId ?? `${input.correlationId}#${input.findingKey}#${input.recommendationId}`;
}
