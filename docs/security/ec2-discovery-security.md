# EC2 discovery security

## Trust

- Customer EC2 reads use **AssumeRole** only (Sprint 13). Platform Lambda has **no** `ec2:*` in `template.yaml`.
- Temporary credentials are not persisted or audited.

## Customer IAM (add to integration role)

- `ec2:DescribeInstances`
- `ec2:DescribeImages` (scoped by `Owners: self` in client)
- `ec2:DescribeVolumes`
- `ec2:DescribeAddresses`
- `ec2:DescribeNetworkInterfaces`
- `ec2:DescribePlacementGroups`
- `ec2:DescribeLaunchTemplates`

## Data handling

- Tags sanitized (secret-like keys dropped).
- No user data, session tokens, or External ID in logs/responses.
- Unknown EC2 API failures are logged server-side with internal detail; public **500** responses use a fixed generic message (`ENGINE_ERROR`) and never return raw `Error.message`, stack traces, DynamoDB table names, or AWS SDK metadata.

## Tenant isolation

- All queries scoped by trusted `tenantId` + `accountId`.

Replace broad `ReadOnlyAccess` with the list above for production customers (see Sprint 13 security report).
