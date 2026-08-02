# AWS account discovery

## Purpose

After a successful STS AssumeRole, SISU'M discovers read-only account metadata using **temporary credentials only**. Discovery validates that the assumed identity belongs to the registered 12-digit AWS account ID and persists sanitized results under `metadata.discovery`.

## Flow

1. Resolve tenant from trusted request context (never from client-supplied tenantId).
2. Load tenant-scoped AWS account record.
3. AssumeRole via `StsCredentialProvider` (cached, refreshable session).
4. Call read-only AWS APIs: `sts:GetCallerIdentity`, `ec2:DescribeRegions`, optional `iam:ListAccountAliases`, optional `organizations:DescribeOrganization`.
5. Run structured permission summary (execution read checks + discovery checks).
6. Fail closed if discovered account ID ≠ registered account ID.
7. Persist `metadata.discovery` with optimistic locking.
8. Return sanitized discovery payload (no credentials).

## API

`POST /api/v1/aws-accounts/:accountId/discovery`

Same management roles as verify (Tenant Owner, Tenant Admin, Security Admin). Safe 404 for missing or cross-tenant records.

## Non-goals

- No credential persistence
- No write/delete/stop/terminate probes
- No proof of zero write permissions from read success alone

See also: `docs/security/aws-assumerole-least-privilege.md`.
