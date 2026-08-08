# EC2 async intelligence jobs

Engineer 1 exposes **durable, tenant-scoped async jobs** that enqueue EC2 intelligence work (discovery, cost, security, governance) without blocking the API Lambda on long-running analysis.

## Flow

Verified account + validated regions → idempotent job row in `SisumAsyncJobsTable` → SQS message on `SisumEc2IntelligenceQueue` → HTTP **202** with `jobId`, `status`, `queueStatus`, `correlationId`. Workers (Engineer 2) consume SQS, reload the job from DynamoDB, validate tenant/account scope, and advance `status` / `stage`.

## Lifecycle

| Field | Values |
|-------|--------|
| `status` | `QUEUED` → `RUNNING` → `SUCCEEDED` / `PARTIAL` / `FAILED` |
| `queueStatus` | `PENDING` → `ENQUEUED` or `ENQUEUE_FAILED` |
| `stage` | `ENQUEUE` → pipeline stages → `COMPLETE` |

Events append to the same table (`ec2.async_job.created`, `ec2.async_job.enqueued`, `ec2.async_job.enqueue_failed`, worker-driven transitions).

## Idempotency

Clients send **`Idempotency-Key`** (header). The API derives a deterministic `jobId` per tenant + key. The repository stores an idempotency mapping with a **request fingerprint** (SHA-256 of account, sorted regions, job type). Same key + same payload replays the existing job; same key + different payload → **409** `IDEMPOTENCY_CONFLICT`.

## Dual-write failure (DynamoDB + SQS)

Job creation is transactional (job + idempotency items). Enqueue is **after** commit. If SQS `SendMessage` fails, the producer sets `queueStatus: ENQUEUE_FAILED`, appends `ec2.async_job.enqueue_failed`, and returns **503** `EC2_ASYNC_JOB_ENQUEUE_FAILED`. Retries with the **same** Idempotency-Key re-attempt enqueue without creating a duplicate job row.

## IAM and messaging

- **Producer Lambda**: `sqs:SendMessage` only on `SisumEc2IntelligenceQueue` ARN (no `sqs:*`, no `ReceiveMessage`).
- **Queue**: SSE enabled, DLQ with `maxReceiveCount: 5`, retention 4 days (main) / 14 days (DLQ).
- **Queue message contract**: `schemaVersion`, `jobId`, `tenantId`, `accountId`, `regions`, `jobType`, `correlationId` — no role ARNs, external IDs, or credentials.

## Components

| Layer | Location |
|-------|----------|
| Models | `backend/async-jobs/ec2-async-job-models.ts` |
| Queue message | `backend/async-jobs/ec2-intelligence-queue-message.ts` |
| Keys / fingerprint | `backend/database/async-jobs/` |
| Repository | `mock-ec2-async-job-repository.ts`, `dynamodb-ec2-async-job-repository.ts` |
| Producer | `backend/services/ec2-async-job-producer-service.ts` |
| Read API | `backend/services/ec2-async-job-api-service.ts` |
| Routes | `backend/api/routes/ec2-async-job.routes.ts` |
| SAM | `backend/template.yaml` (`SisumAsyncJobsTable`, `SisumEc2IntelligenceQueue`) |

See also: `docs/handoff/ec2-async-job-engineer-2.md`, `docs/validation/ec2-async-job-production-validation.md`.
