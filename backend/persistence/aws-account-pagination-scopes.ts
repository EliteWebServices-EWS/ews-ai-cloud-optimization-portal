export const AWS_ACCOUNT_PAGINATION_SCOPES = {
  tenantList: (tenantId: string) => `aws-account:tenant:${tenantId}`,
  statusList: (tenantId: string, status: string) =>
    `aws-account:status:${tenantId}:${status}`,
} as const;
