# EC2 async intelligence jobs — production validation

## Prerequisites

- Tenant user with `tenant_admin`, `security_admin`, or `analyst` for start; `viewer` / `auditor` for read APIs
- AWS account connection **VERIFIED** for the target `accountId`
- Deployed stack includes `SisumAsyncJobsTable`, `SisumEc2IntelligenceQueue`, `EC2_INTELLIGENCE_QUEUE_URL`, `ASYNC_JOBS_TABLE_NAME`

## Start job

```http
POST /api/v1/analysis/ec2/start
Authorization: Bearer <access_token>
Idempotency-Key: <unique-client-key>
Content-Type: application/json

{
  "accountId": "<verified-account-id>",
  "regions": ["us-east-1"]
}
```

Expect **202**, `queueStatus: ENQUEUED`, stable `jobId` when reusing the same Idempotency-Key and body. Missing Idempotency-Key → **422**. Unknown or other-tenant account → **404**. Unverified account → **409**. Extra body fields → **422**.

## Enqueue failure path

Simulate SQS deny or outage. Expect **503** `EC2_ASYNC_JOB_ENQUEUE_FAILED`, job row with `queueStatus: ENQUEUE_FAILED`. Retry POST with the **same** Idempotency-Key; expect **202** after queue recovery.

## Read APIs

```http
GET /api/v1/analysis/jobs
GET /api/v1/analysis/jobs/{jobId}
GET /api/v1/analysis/jobs/{jobId}/events
```

Responses must not include idempotency keys, fingerprints, or AWS credentials. Cross-tenant `jobId` → **404**.

## Queue message inspection

CloudWatch / SQS sample: message JSON contains only contract fields (no `roleArn`, `externalId`, session tokens).

## IAM review

Lambda execution role includes `sqs:SendMessage` on the intelligence queue ARN only (no blanket `sqs:*`, no `ReceiveMessage` on producer policy). Worker role (Engineer 2) receives messages separately.

## Automated regression

From `backend/`:

```bash
npm run test:ec2-async-jobs
```
