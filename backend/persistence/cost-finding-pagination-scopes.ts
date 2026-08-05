export const COST_FINDING_PAGINATION_SCOPES = {
  tenantList: (tenantId: string) => `cost-finding:tenant:${tenantId}`,
  accountList: (tenantId: string, accountId: string) =>
    `cost-finding:account:${tenantId}:${accountId}`,
} as const;
