# EC2 async job operations runbook

Operational guide for the Sprint 15 EC2 intelligence **async job pipeline** (SQS → consumer Lambda → DynamoDB job state). Complements `docs/operations/10.5.10-production-monitoring.md`.

## Architecture summary

| Component | Name pattern (production) |
|-----------|---------------------------|
| Work queue | `sisum-ec2-intelligence-${Environment}` |
| DLQ | `sisum-ec2-intelligence-dlq-${Environment}` |
| Consumer Lambda | `sisum-ec2-analysis-consumer-${Environment}` |
| Job table | `sisum-async-jobs-${Environment}` |
| API producer | `sisum-backend-${Environment}` (enqueue only) |

Flow: HTTP API creates durable job → SQS message → consumer reloads job, validates tenant/account, advances `status` / `stage` with leases and idempotent stage runs. **No Step Functions / EventBridge orchestration.**

Consumer settings (do not change without architecture review): Lambda timeout **300s**, queue visibility **1800s**, batch size **1**, partial batch failures, DLQ **maxReceiveCount 5**.

## Dashboard

CloudFormation stack: **`sisum-production-monitoring`** (see `infrastructure/monitoring/template.yaml`).

Dashboard: **`SISUM-${Environment}-Operations`** — EC2 section includes queue depth, oldest message age, DLQ depth, consumer Lambda metrics, job success % (terminal jobs only), retry intensity, and terminal event counts.

## Monitoring stack deployment (ownership)

| Item | Detail |
|------|--------|
| Template | `infrastructure/monitoring/template.yaml` |
| Stack name | **`sisum-production-monitoring`** (production) |
| Deployment | **Manual** — not deployed by GitHub Actions backend workflow |
| Operator | Account administrator / ops principal with CloudWatch + Logs permissions |
| **`SisumBackendDeployRole`** | Deploys **backend SAM** only; **does not** own this monitoring stack per repository evidence |
| Pre-requisite | Consumer log group `/aws/lambda/sisum-ec2-analysis-consumer-${Environment}` must exist (backend stack) before metric filters deploy |
| Post-merge validation | `aws cloudformation validate-template`, stack update, confirm dashboard widgets and custom metrics receive data under load |

Command pattern (from `docs/operations/10.5.10-production-monitoring.md`):

```bash
aws cloudformation deploy \
  --template-file infrastructure/monitoring/template.yaml \
  --stack-name sisum-production-monitoring \
  --parameter-overrides Environment=production \
  --region us-east-1
```

Verify deployment IAM for CloudWatch dashboards/alarms and Logs metric filters **before** live update.

## Alarm catalog

| Alarm | Meaning |
|-------|---------|
| `sisum-${Environment}-ec2-intelligence-dlq-depth` | ≥1 message on DLQ (retries exhausted) |
| `sisum-${Environment}-ec2-intelligence-queue-age` | Oldest visible work-queue message age > threshold (default **900s**) |
| `sisum-${Environment}-ec2-analysis-consumer-errors` | Lambda **Errors** ≥1 (infrastructure) |
| `sisum-${Environment}-ec2-analysis-consumer-throttles` | Lambda **Throttles** ≥1 |
| `sisum-${Environment}-ec2-analysis-consumer-near-timeout` | Lambda **Duration** Maximum > **270000 ms** (near 300s timeout; not proof of hard timeout) |
| `sisum-${Environment}-ec2-async-job-high-retry-rate` | **Retry intensity** `100 × retries / starts` > threshold (default **25**; can exceed **100**) |

All use SNS topic **`sisum-${Environment}-monitoring-alarms`**.

## Business metrics (definitions)

Custom metrics come from **structured audit JSON** written by `writeAuditEvent()` in the **consumer Lambda** (`console.info` / `console.error` one-line JSON with top-level `eventName`). Metric filters on `/aws/lambda/sisum-ec2-analysis-consumer-${Environment}` — **not** DynamoDB audit persistence alone.

| Metric | Source audit `eventName` |
|--------|--------------------------|
| JobsStarted | `ec2.async_job_started` |
| JobsSucceeded | `ec2.async_job_succeeded` |
| JobsFailed | `ec2.async_job_failed` |
| JobRetryEvents | `ec2.async_job_retrying` |

**Success rate (dashboard):**
`100 × JobsSucceeded / (JobsSucceeded + JobsFailed)` when **Succeeded + Failed > 0**, else **0** (no terminal job evidence — **not** 100% health). Use **EC2 Job Terminal Events (Counts)** alongside the success % widget.

**Retry intensity (dashboard; not unique-job retry %):**
`100 × JobRetryEvents / JobsStarted` when JobsStarted > 0, else **0**. One job with multiple retries can yield values **> 100** (e.g. 1 start + 3 retries → **300**). This counts **retry audit events**, not deduplicated jobs.

**Sparse / no traffic:** Zero starts → retry intensity **0** (alarm uses `TreatMissingData: notBreaching`). Zero terminal outcomes → success expression **0**, not false perfect health.

**PARTIAL (job vs stage):** `Ec2AsyncJobStatus` includes `PARTIAL`, but **`executeIntelligencePipeline` FINALIZING sets `status: 'SUCCEEDED'`** — no `job.status = 'PARTIAL'` in consumer code. **`ec2.async_job_partial`** is defined but **not emitted**. Stage analysis runs may be **PARTIAL** in cloud-resource tables; that is **stage-level**, not overall job terminal **PARTIAL**.

## Required audit / observability coverage

| Requirement | Implementation / owner | Classification |
|-------------|------------------------|----------------|
| Job queued | API `writeAuditEvent`: `ec2.async_job_created` / `ec2.async_job_enqueued`; durable `ec2.async_job.enqueued` job event | **APPLICATION AUDIT** + **DURABLE JOB EVENT** (API Lambda) |
| Job started | Consumer `writeAuditEvent`: `ec2.async_job_started`; job event `ec2.async_job_started` | **APPLICATION AUDIT** + **DURABLE JOB EVENT** |
| Retry | Consumer `writeAuditEvent`: `ec2.async_job_retrying` once per successful `markRetrying`; job event `ec2.async_job_retrying` | **APPLICATION AUDIT** + **DURABLE JOB EVENT** |
| Partial success (overall job) | Not emitted; stage runs may be PARTIAL in stage tables | **STAGE-LEVEL EVENT** only (not job terminal PARTIAL today) |
| Failed (business) | Consumer `writeAuditEvent`: `ec2.async_job_failed`; job event `ec2.async_job_failed` | **APPLICATION AUDIT** + **DURABLE JOB EVENT** |
| Completed (success) | Consumer `writeAuditEvent`: `ec2.async_job_succeeded`; job event `ec2.async_job_succeeded` | **APPLICATION AUDIT** + **DURABLE JOB EVENT** |
| DLQ moved | SQS redrive policy after max receives; DLQ depth alarm | **AWS SERVICE OBSERVABILITY** (no app `DLQ_MOVED` audit) |
| Redrive completed | No automated redrive workflow in repo | **NOT YET AVAILABLE WITHOUT A REAL REDRIVE WORKFLOW** |

## Lifecycle / audit inventory (summary)

| Visibility | Classification |
|------------|----------------|
| Job queued (`ec2.async_job_enqueued` / created) | **EXISTING_APPLICATION_EVENT** (API Lambda audit) |
| Job started | **EXISTING_APPLICATION_EVENT** (`ec2.async_job_started`) |
| Retry | **EXISTING_APPLICATION_EVENT** (`ec2.async_job_retrying` audit + job event) |
| Partial success (overall job) | **NOT_CURRENTLY_RELIABLY_OBSERVABLE** (stage PARTIAL only) |
| Failed (business) | **EXISTING_APPLICATION_EVENT** (`ec2.async_job_failed`) |
| Completed (success) | **EXISTING_APPLICATION_EVENT** (`ec2.async_job_succeeded`) |
| DLQ moved | **AWS_SERVICE_LEVEL_OBSERVABILITY** (SQS DLQ metrics/alarms; **not** fabricated app audit) |
| Redrive completed | **NOT_CURRENTLY_RELIABLY_OBSERVABLE** (no automated redrive workflow yet) |

## Investigation procedures

### Queue depth

1. Dashboard: **EC2 Queue Depth**.
2. CLI: `aws sqs get-queue-attributes --queue-url <work-queue-url> --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible`
3. Check consumer **Invocations** vs depth; inspect **RUNNING** jobs and **leaseExpiresAt** in DynamoDB.
4. Do **not** purge the queue to “fix” depth.

### Oldest message age

1. Dashboard: **EC2 Oldest Message Age**.
2. Alarm threshold default **900s** (between 300s Lambda timeout and 1800s visibility).
3. Likely causes: consumer errors/throttles, stuck **RUNNING** job, retry storms, downstream AWS API slowness.

### Consumer Lambda errors

1. Alarm: **ec2-analysis-consumer-errors**.
2. Log group: `/aws/lambda/sisum-ec2-analysis-consumer-${Environment}`
3. Distinguish **Lambda Errors** (infra) from **`ec2.async_job_failed`** (business terminal).

### Consumer throttles

1. Alarm: **ec2-analysis-consumer-throttles**.
2. Check account concurrency limits and duplicate pollers (should be single event source mapping).

### Near-timeout / duration

1. Alarm: **ec2-analysis-consumer-near-timeout** (Duration **Maximum** > 270s).
2. This indicates long stage work approaching the **300s** Lambda limit, not a dedicated `Timeouts` metric (which does not exist on `AWS/Lambda`).
3. Inspect stage (discovery/cost/security/governance) and customer-account API latency.

### High retry intensity

1. Dashboard: **EC2 Retry Intensity (retries per 100 starts)** and retry event counts.
2. Values **> 100** mean multiple retry events per start (expected under this definition).
3. Alarm compares intensity to **Ec2JobRetryAlarmThresholdPercent** (default 25) over two 5-minute periods.

### FAILED jobs

1. Job status **FAILED** in `sisum-async-jobs-*`.
2. Audit: `ec2.async_job_failed`.
3. Do not replay non-retryable failures until root cause is fixed.

### PARTIAL jobs

1. Overall job **PARTIAL** status is not set by the current consumer completion path.
2. Investigate **stage run** records with `PARTIAL` in cloud-resource/stage tables if analysis quality is degraded.

### RUNNING jobs and leases

1. Jobs in **RUNNING** with active **executionOwnerId** / **leaseExpiresAt** (stage execution leases, default **360s**).
2. Stale lease recovery is version-based; see `docs/handoff/ec2-async-job-engineer-2.md`.
3. Do not assume a RUNNING job is orphaned until lease expiry and retry semantics are checked.

## DLQ investigation

1. Alarm **DLQ depth** or dashboard **EC2 DLQ Depth**.
2. Inspect DLQ messages (body contains `jobId`, `tenantId`, `accountId`, `correlationId` only — no secrets).
3. **DLQ movement is performed by SQS** after **maxReceiveCount**; there is **no** application `DLQ_MOVED` audit event.

## Safe DLQ replay / redrive

Before redrive:

- Confirm durable job row exists and tenant/account scope is correct.
- Understand root cause; check **failureRetryable**, **retryCount**, active leases.
- Verify customer AWS account still **VERIFIED** where required.
- Use **AWS SQS redrive** (DLQ → work queue) only; do not invent new job IDs.
- **Redrive completion** is not auto-audited today; record change ticket / manual verification steps after redrive.

Post-redrive:

- Watch queue depth, oldest age, consumer errors, success/retry metrics.
- Confirm job progresses or reaches terminal state.

## Audit evidence

Query CloudWatch Logs (consumer log group) for structured audit JSON:

- `eventName` in (`ec2.async_job_started`, `ec2.async_job_retrying`, `ec2.async_job_succeeded`, `ec2.async_job_failed`)
- Fields may include `jobId`, `correlationId`, `tenantId`, `accountId`, `reason` — never tokens or credentials.

DynamoDB job event stream: `ec2.async_job_*` event types on the job record.

## Escalation

- DLQ ≥1: investigate within SLA; treat as customer-visible pipeline failure.
- Sustained queue age or retry rate: platform + application owner.
- Repeated near-timeout: capacity / stage optimization.

## Rollback

Redeploy previous **`infrastructure/monitoring/template.yaml`** revision. Consumer/backend rollback is independent; do not delete queues or DLQ during monitoring rollback.

## Deploying monitoring changes

See **Monitoring stack deployment (ownership)** above. Redeploy previous template revision to roll back monitoring-only changes.

## IAM note

Monitoring template adds CloudWatch dashboards/alarms and Logs metric filters. Confirm the **deploying operator principal** (not necessarily `SisumBackendDeployRole`) can manage those resources in the target account/region.
