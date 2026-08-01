# AWS account registration data model

## Purpose

Persist customer AWS account onboarding metadata (role ARN, external ID, region, lifecycle state) for multi-tenant SISU'M. This layer enables durable registration and optimistic concurrency; it does **not** perform STS AssumeRole, trust-policy validation, or HTTP APIs.

## Scope / non-goals

- No STS calls or live AWS permission checks (Engineer 2)
- No REST/GraphQL APIs (Engineer 3)
- No long-lived credentials, access keys, secret keys, session tokens, or TOTP secrets
- No DynamoDB Scan — Query-only access patterns

## Record model

| Field | Description |
| --- | --- |
| `accountId` | 12-digit AWS account ID |
| `tenantId` | Owning SISU'M tenant |
| `roleArn` | IAM role ARN; account segment must match `accountId` |
| `externalId` | AssumeRole external ID (stored, never logged by this layer) |
| `region` | Primary onboarding region |
| `status` | Lifecycle status |
| `verificationStatus` | Validation sub-state |
| `lastValidated` | ISO timestamp of the most recent **completed** validation attempt (success or failure) |
| `metadata` | JSON-safe object |
| `version` | Optimistic lock (integer ≥ 1) |
| `createdAt` / `updatedAt` | ISO timestamps |

## Lifecycle matrix

| From \\ To | VALIDATING | VERIFIED | PENDING | SUSPENDED | DELETED |
| --- | --- | --- | --- | --- | --- |
| PENDING | ✓ | | | | ✓ |
| VALIDATING | | ✓ | ✓ | ✓ | ✓ |
| VERIFIED | ✓ | | | ✓ | ✓ |
| SUSPENDED | ✓ | ✓ | | | ✓ |
| DELETED | | | | | (terminal) |

Same-state transitions are rejected.

## Verification rules

- `PENDING`: `NOT_STARTED` or `FAILED`
- `VALIDATING`: `IN_PROGRESS` (may retain prior `lastValidated` from an earlier completed attempt)
- `VERIFIED`: `SUCCEEDED`
- `lastValidated` is set when a validation attempt completes with `SUCCEEDED` or `FAILED`; it is **not** cleared when re-entering `VALIDATING` (`IN_PROGRESS`)
- Suspension does not erase prior validation timestamps

## DynamoDB table

- Name: `sisum-aws-accounts-${Environment}` (`SisumAwsAccountsTable`)
- Billing: PAY_PER_REQUEST, SSE, PITR, Retain on stack delete

### Keys

| Item | PK | SK |
| --- | --- | --- |
| Registration | `TENANT#<tenantId>` | `AWS_ACCOUNT#<accountId>` |
| Uniqueness lock | `AWS_ACCOUNT_LOCK#<accountId>` | `LOCK` |

### GSI access patterns

| Index | PK | SK | Use |
| --- | --- | --- | --- |
| gsi1 | `AWS_ACCOUNT#<accountId>` | `TENANT#<tenantId>` | Global account lookup (internal) |
| gsi2 | `TENANT#<tenantId>#AWS_ACCOUNT_STATUS#<status>` | `UPDATED_AT#<updatedAt>#AWS_ACCOUNT#<accountId>` | Tenant status listing |

Tenant listing: Query base table `PK = TENANT#<tenantId>` and `begins_with(SK, "AWS_ACCOUNT#")`.

## Global uniqueness (Option A)

Each AWS account ID may be registered to **at most one tenant**. Enforced with a conditional lock item written in the same `TransactWriteItems` as the registration record. GSI1 supports lookup but does not enforce uniqueness alone.

## Optimistic locking

Updates require `expectedVersion`; DynamoDB condition `#version = :expectedVersion` and increment by 1. Conflicts map to `RepositoryConflictError`.

## Tenant isolation

All mutating operations are tenant-scoped except `getByAccountId`, documented for platform/internal use only.

## External ID handling

Required, trimmed, max length 256. Never included in logs in this task’s code paths. No hardcoded production external IDs.

## Repository factory

- Env: `AWS_ACCOUNTS_TABLE_NAME`
- Deployed staging/production: fail closed if table env missing when persistence enabled
- Local/test: in-memory mock when persistence disabled or tables incomplete

## Downstream integration (Engineer 2)

Engineer 2 will consume `AwsAccountRepository`, call STS AssumeRole using stored `roleArn` + `externalId`, update verification fields via `transitionStatus` / `update`, and perform live permission validation. This task stores metadata only.
