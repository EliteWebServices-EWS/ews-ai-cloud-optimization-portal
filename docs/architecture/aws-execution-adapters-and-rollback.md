# AWS Execution Adapters and Rollback

## Architecture

The execution adapter layer sits beside the existing mock `ExecutionSimulator`. Production-oriented changes flow through:

1. **Adapter registry** — resolves `AwsExecutionService` to a bounded adapter implementation.
2. **Execution orchestrator** — runs validate → snapshot → execute → verify → rollback, persists run state, and emits audit events.
3. **Execution run repository** — durable tenant-scoped records stored in the `EXECUTION_PLANS` DynamoDB table (`EXECUTION_RUN#` sort keys) with optimistic locking.

AWS SDK v3 clients are injected through `AwsExecutionClientFactory` (regional cache). Business code never constructs clients directly.

## Supported services and actions

| Service | Actions |
|---------|---------|
| EC2 | `START_INSTANCE`, `STOP_INSTANCE`, `UPDATE_TAGS` |
| Auto Scaling | `UPDATE_DESIRED_CAPACITY` |
| RDS | `MODIFY_BACKUP_RETENTION`, `START_INSTANCE`, `STOP_INSTANCE` |
| S3 | `PUT_BUCKET_TAGGING` |
| CloudFront | `UPDATE_COMMENT` (uses distribution ETag) |
| Lambda | `UPDATE_FUNCTION_CONFIGURATION` (memory and/or timeout) |

Unknown services and unsupported actions fail closed with typed errors.

## Execution modes

- **VALIDATION** — configuration and read-only AWS checks only.
- **DRY_RUN** — deterministic plan; no mutating calls.
- **PRODUCTION** — full lifecycle with persistence and audit.

## Lifecycle

Resolve adapter → validate → (VALIDATION return | DRY_RUN plan | PRODUCTION persist + audit) → capture previous configuration → execute → verify → on failure rollback when eligible.

## Rollback behavior

| Adapter | Rollback |
|---------|----------|
| EC2 | Reverts tags; stop/start when prior state allows |
| Auto Scaling | Restores previous desired capacity |
| RDS | Restores backup retention; stop after failed start; **RDS stop is non-reversible** |
| S3 | Restores previous bucket tags |
| CloudFront | Restores comment using fresh ETag |
| Lambda | Restores memory/timeout |

## Persistence model

`ExecutionRunRecord` fields include: tenant, actor, correlation/request IDs, mode, service, action, resource, `previousConfiguration`, `executionSnapshot`, validation/execution/verification/rollback results, rollback eligibility, version, timestamps.

## Audit events

- `execution.started`
- `execution.succeeded`
- `execution.failed`
- `rollback.started`
- `rollback.completed`
- `rollback.failed`

Audit payloads exclude secrets and raw credentials.

## Security boundaries

No arbitrary SDK execution, deletions, IAM mutation, or bucket/object deletion. Tenant and actor context are required.

## Test strategy

Unit tests mock AWS SDK clients and cover registry resolution, orchestration modes, rollback, audit emission, tenant retention, and per-adapter behavior.

## Known limitations

- CloudFront updates are limited to comment changes.
- RDS stop rollback is manual/non-automated.
- Live AWS integration requires IAM permissions not yet added to the deployment role (EC2, ASG, RDS, S3, CloudFront, Lambda read/write scoped actions).
