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
- Malformed or permanently invalid SQS payloads: log + acknowledge (omit from `batchItemFailures`) so identical poison messages are not retried forever; do not manually send to the DLQ.
- Retryable processing failures: increment `retryCount`, append `ec2.async_job_retrying`, return the record `messageId` in `batchItemFailures`.

## Worker implementation (Engineer 2)

| Component | Location |
|-----------|----------|
| SQS batch handler | `backend/ec2-analysis-consumer/process-sqs-batch.ts` |
| Lambda entry | `backend/lambda-ec2-analysis-consumer.ts` |
| Consumer service | `backend/services/ec2-async-job-consumer-service.ts` |
| Message parser | `backend/async-jobs/parse-ec2-intelligence-queue-message.ts` |
| SAM function | `SisumEc2AnalysisConsumerFunction` on `SisumEc2IntelligenceQueue` with `ReportBatchItemFailures` |

Pipeline reuse (no duplicate engines):

1. **DISCOVERY** — `Ec2DiscoveryApiService.startDiscovery`
2. **COST_ANALYSIS** — `Ec2CostAnalysisApiService.startCostAnalysis`
3. **SECURITY_ANALYSIS** — `Ec2SecurityAnalysisApiService.startSecurityAnalysis` (includes EC2 governance findings via `Ec2SecurityAnalysisOrchestrator` / `analyzeEc2Security`)
4. **GOVERNANCE_ANALYSIS** — durable stage boundary only; governance outputs are persisted during security analysis
5. **FINALIZING** — terminal job transition to `SUCCEEDED` / `COMPLETE`

Recovery uses durable `status`, `stage`, and `version` only (reload after claim conflicts; resume from current stage; skip completed stages).

## Effectively-once business processing (stage runs)

SQS is **at-least-once**; the worker targets **effectively-once business output** using existing stage run rows (no new tables).

| Concept | Representation |
|---------|----------------|
| Logical stage identity | `{jobId}#discovery`, `{jobId}#cost`, `{jobId}#security` |
| Execution attempt | `attemptCount` on the stage run row (incremented on stale reclaim or retryable FAILED reclaim) |
| Ownership / lease | `executionOwnerId` + `leaseExpiresAt` on the run row |
| Completion proof | `SUCCEEDED` or `PARTIAL` + `completedAt` (orchestrator finishes child writes before `completeRun`) |

**Lease:** `360s` (`EC2_STAGE_EXECUTION_LEASE_SECONDS`) — greater than the `300s` Lambda timeout so a healthy invocation is not preempted.

**State machine (run row):**

- `missing` → `claimExecution` creates `RUNNING` + lease (attempt 1)
- `RUNNING` + active lease → worker returns **retry** (no duplicate stage execution)
- `RUNNING` + expired lease → conditional **reclaim** (attempt +1) then execute once
- `FAILED` + `failureRetryable: true` → conditional reclaim to `RUNNING` then execute (upserts prevent duplicate findings/recommendations)
- `FAILED` + `failureRetryable: false` → terminal (e.g. cost instance limit exceeded)
- `SUCCEEDED` / `PARTIAL` + `completedAt` → never returned to `RUNNING`; worker skips engines and repairs job stage if needed

**Counters:** `job.retryCount` tracks SQS/message processing retries; `attemptCount` tracks durable stage execution claims only (not incremented when skipping completed stages).

## References

- Architecture: `docs/architecture/ec2-async-intelligence-jobs.md`
- Producer / API tests: `backend/tests/integration/ec2-async-job-api-http.test.ts`
- Repository contract: `backend/repositories/contracts/ec2-async-job-repository.ts`
