# Engineer 2 handoff — EC2 async intelligence worker

## Your scope

Implement the **SQS consumer** that processes `EC2_INTELLIGENCE` jobs enqueued by Engineer 1. Do not trust the message alone for authorization context.

## Required worker behavior

1. **Reload durable job** from `ASYNC_JOBS_TABLE_NAME` using `tenantId` + `jobId` from the message. If missing, dead-letter or skip with structured log (no retry storm on orphan messages).
2. **Validate scope**: message `tenantId`, `accountId`, and `regions` must match the stored job record and the tenant’s verified AWS account connection before calling STS or EC2 APIs.
3. **Optimistic locking**: update job status/stage with `expectedVersion`; on conflict, reload and reconcile.
4. **Append events** for each meaningful transition (`ec2.async_job.running`, stage changes, terminal outcomes).
5. **AssumeRole** only in the worker path (producer intentionally does **not** use STS).

## Message contract

Parse `Ec2IntelligenceQueueMessage` (`schemaVersion: 1`). Fields: `jobId`, `tenantId`, `accountId`, `regions`, `jobType: EC2_INTELLIGENCE`, `correlationId`. Never expect or log secrets in the payload.

## Idempotency at worker

SQS may deliver duplicates. Use job row state (`status`, `stage`, `queueStatus`) to make handlers idempotent. A job already `RUNNING` or terminal should not restart from scratch unless product rules define explicit retry.

## Failure handling

- Transient AWS errors: retry via SQS visibility timeout; respect DLQ after **5** receives (`maxReceiveCount`).
- Terminal job failure: set `status: FAILED`, set `errorSummary` safe for API exposure, append event.

## References

- Architecture: `docs/architecture/ec2-async-intelligence-jobs.md`
- Producer / API tests: `backend/tests/integration/ec2-async-job-api-http.test.ts`
- Repository contract: `backend/repositories/contracts/ec2-async-job-repository.ts`
