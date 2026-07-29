export const EXECUTION_PAGINATION_SCOPES = {
  tenantList: (tenantId: string) => `execution:tenant:${tenantId}`,
  workflowList: (tenantId: string, workflowId: string) =>
    `execution:workflow:${tenantId}:${workflowId}`,
  statusList: (tenantId: string, status: string) =>
    `execution:status:${tenantId}:${status}`,
  historyList: (tenantId: string, executionId: string) =>
    `execution:history:${tenantId}:${executionId}`,
} as const;
