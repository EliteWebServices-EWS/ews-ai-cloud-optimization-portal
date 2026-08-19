export const ACTION_LOG_PAGINATION_SCOPES = {
  correlationList: (tenantId: string, correlationId: string) =>
    `action-log:correlation:v1:${tenantId}:${correlationId}`,
  decisionList: (tenantId: string, decisionId: string) =>
    `action-log:decision:v1:${tenantId}:${decisionId}`,
  executionList: (tenantId: string, executionId: string) =>
    `action-log:execution:v1:${tenantId}:${executionId}`,
  resourceList: (tenantId: string, accountId: string, resourceId: string) =>
    `action-log:resource:v1:${tenantId}:${accountId}:${resourceId}`,
} as const;
