# EC2 async reporting

## Overview

Live EC2 intelligence jobs (`EC2_INTELLIGENCE`) persist stage outputs in DynamoDB (discovery, cost, security). When the async consumer reaches **FINALIZING**, it projects a tenant-scoped optimization report into the existing **Reporting Engine** repository. The Reports UI reads those records via `GET /api/v1/reports`; it does not synthesize live data on the client.

## Relationship to the workflow Reporting Engine

| Source | `reportSource` | Created by |
|--------|----------------|------------|
| Legacy optimization workflow | `workflow` or unset (backward compatible) | `POST /reports/generate` after workflow completion |
| Mock workflow in mock provider mode | `demo` | Same generate endpoint when `PROVIDER_MODE=mock` |
| Live EC2 async intelligence | `ec2_async` | `Ec2AsyncReportProjectionService` during FINALIZING |

Report shape reuses `OptimizationReport`. EC2 async reports set `workflowId` to `ec2-async:<jobId>` and `ec2AsyncJobId` to the durable job id. Idempotency uses a `REPORTEC2JOB#<jobId>` pointer (mirroring `REPORTWF#<workflowId>`).

## Confidence Engine

The workflow **Confidence Engine** runs only in the workflow orchestrator (`WORKFLOW_STAGES.CONFIDENCE`) with standardized workflow evidence. The EC2 async pipeline does **not** invoke it.

Cost recommendations carry **EC2 cost confidence** (`confidenceScore` / `confidenceLevel`) from the cost intelligence layer. Those values are copied into report recommendation entries when present. When there are zero recommendations, list/detail APIs expose `confidenceStatus: NOT_APPLICABLE` — no fabricated 100% scores.

## Zero-instance behavior

A successful job with zero discovered instances produces a **complete** report with:

- `opportunityCount` 0
- `estimatedMonthlySavings` 0
- empty `recommendations`
- security/governance blocks reflecting **completed-empty** persisted summaries (not “not yet run”)

## Demo vs live

Historical demo workflow reports remain in the reports table. They are not deleted or relabeled. New workflow reports in mock provider mode are stored with `reportSource: demo`. Live async reports are `ec2_async`. The Reports page labels each row from backend `reportSource`.

## Post-completion refresh

When EC2 analysis completes, the Decision Dashboard sets a session freshness signal. The Reports page `initialize()` consumes it and reloads `listReports()` once so a newly projected async report appears without implying mock fallback.

## Failure semantics

Report projection failure during **FINALIZING** throws a **retryable** consumer error. The job remains **`RUNNING` / `FINALIZING`** until projection succeeds; it does **not** transition to **`SUCCEEDED`** without a persisted report (when projection is required for FINALIZING).

## Idempotency

- Stable report id: `deriveEc2AsyncReportId(tenantId, jobId)`
- Job pointer: `REPORTEC2JOB#<jobId>`
- Create uses conditional `attribute_not_exists(sk)` on report, workflow pointer, and job pointer items in a single transact write; concurrent workers resolve to one report.

## Known limitations

- Governance stage in the async consumer is a gate only; governance narrative in reports is derived from security summaries and recommendation counts, not the workflow governance engine.
- Workflow Confidence Engine evidence (telemetry package) is unavailable to EC2 async until a future unified evidence model exists.
