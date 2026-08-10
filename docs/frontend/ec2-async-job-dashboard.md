# EC2 async job dashboard (frontend)

Authenticated Decision Dashboard (`frontend/dashboard/index.html`) integrates Engineers 1–3 EC2 asynchronous analysis APIs for progress, history, retry, and completion refresh.

## Architecture

- **Entry:** `frontend/dashboard/src/main.ts` — auth guard, tenant AWS account select, `Ec2DashboardController` (live EC2 widgets), `Ec2AsyncJobController` (async jobs), `DecisionDashboard`.
- **Analyze Environment:** `DecisionDashboard.analyzeEnvironment()` → `Ec2AsyncJobController.startAnalysisFromUi()` (no synchronous `/workflows/run` on this page).
- **API module:** `frontend/dashboard/src/api/ec2-async-job-api.ts` uses shared `apiRequest()` from `api/client.ts`.
- **Progress UI:** `#progress-panel` via `render-ec2-async-job-progress.ts`.
- **History UI:** `#job-history-panel` via `render-ec2-async-job-history.ts`.
- **Polling:** single `Ec2AsyncJobPoller` instance per active job in `Ec2AsyncJobController`.
- **Cross-page freshness:** `ec2-async-job-freshness.ts` writes a `sessionStorage` signal after successful job completion so `reports.html` can reload authoritative report data on next open.

## Async start flow

1. User selects tenant-authorized AWS account and region (live EC2 controls).
2. User clicks **Analyze Environment**.
3. Frontend generates `Idempotency-Key: crypto.randomUUID()`.
4. `POST /api/v1/analysis/ec2/start` with body `{ accountId, regions? }`.
5. On success, UI captures `jobId`, shows queued/starting progress, loads job history, polls `GET /api/v1/analysis/jobs/:jobId`.

## API base URL

`import.meta.env.VITE_API_BASE ?? '/api/v1'` in `api/client.ts`. Local Vite proxy forwards `/api` to the backend (`frontend/vite.config.ts`).

## Authentication

All async job calls use `apiRequest()` → `getOrRefreshAccessToken()` → `Authorization: Bearer …`. No duplicate token store. On **401**, session is cleared and Cognito login begins (existing app behavior). API failures do not substitute fake job or recommendation data.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/analysis/ec2/start` | Start job (header `Idempotency-Key`, body `accountId`, optional `regions`) |
| GET | `/analysis/jobs` | Paginated history (`limit`, `nextToken`) |
| GET | `/analysis/jobs/:jobId` | Authoritative job detail (polling) |
| GET | `/analysis/jobs/:jobId/events` | Optional timeline (**not used in UI v1**) |

Responses use `buildSuccessResponse` envelope; client returns `data` only.

## Sanitized job fields (GET list/detail)

`jobId`, `accountId`, `regions`, `jobType`, `status`, `queueStatus`, `stage`, `correlationId`, `retryCount`, `errorSummary`, `createdAt`, `startedAt`, `completedAt`, `version`.

Not exposed: `updatedAt`, `failureRetryable`, execution lease, idempotency internals, worker metadata.

## Status / stage mapping

Implemented in `ec2-async-job-status-mapping.ts`:

| Backend | User label |
|---------|------------|
| `QUEUED` | Queued |
| `QUEUED` + `localStarting` (UI only, after 202) | **Starting** (not a durable backend status) |
| `RUNNING` + `DISCOVERY` | Discovering Resources |
| `RUNNING` + `COST_ANALYSIS` | Running Cost Analysis |
| `RUNNING` + `SECURITY_ANALYSIS` | Running Security Analysis |
| `RUNNING` + `GOVERNANCE_ANALYSIS` | Running Governance Analysis |
| `RUNNING` + `FINALIZING` | Generating Recommendations |
| `RUNNING` + `ENQUEUE` | Starting |
| `SUCCEEDED` + `COMPLETE` | Completed |
| `PARTIAL` + `COMPLETE` | Completed (terminal; job-level `PARTIAL` at completion is rare in current consumer) |
| `PARTIAL` + non-`COMPLETE` | Processing (polling continues) |
| `FAILED` | Failed |
| Unknown | Processing |

Progress bar percentages (5, 10, 25, 45, 65, 80, 90, 100) are **stage milestones**, not exact work completion (documented in UI `aria-label`).

## Polling

- **Normal interval:** 4000 ms (`DEFAULT_INTERVAL_MS`).
- **Backoff on transient errors:** `min(30000, interval × consecutiveErrors)`.
- One poller per active job; `inFlight` prevents overlapping GETs.
- Transient poll errors show a warning; durable status is **not** set to `FAILED`.
- Terminal success/failure stops polling; `destroy()` / `beforeunload` stops timers.
- Hidden document: skips fetch, reschedules (no extra loop).
- Stale responses: generation + active `jobId` guards; poller ignores updates after `stop()`.

## Timestamps and elapsed time

- Display: API `createdAt`, `startedAt`, `completedAt` only; missing/invalid → `—` (`toLocaleString()` when valid).
- Active elapsed: `now - (startedAt ?? createdAt)`.
- Terminal elapsed: `(completedAt ?? startedAt ?? createdAt) - start` (no sanitized `updatedAt`).
- One 1s ticker for active job progress display only.

## Job history

- `GET /analysis/jobs` with `limit: 20`; **Load more** uses `nextToken`.
- Shows mapped status, masked account suffix, regions, `createdAt`.
- Failed and completed jobs remain listed; rows are not polled individually.

## Retry

- **No** `POST .../retry` endpoint.
- Retry = new `POST /analysis/ec2/start` with same `accountId` / `regions` and a **new** `Idempotency-Key`.
- Backend derives `jobId` from `(tenantId, idempotencyKey)` → new key → **new durable job** (failed job row unchanged in history).
- UI: retry button on `FAILED` rows only; `retryInFlight` prevents duplicate submits.
- **`failureRetryable` is not exposed** by the API. Product policy: **FAILED + known `accountId`/`regions` → retry offered** (known limitation).

## Completion refresh (Decision Dashboard)

On terminal success for the active job (matching generation), once per `jobId`:

1. Stop polling and render **Completed**.
2. Fire **Analysis completed** notification (once).
3. `Ec2DashboardController.load()` once (deduped) which calls `LiveEc2DashboardDataProvider.loadDashboard()`:
   - `fetchEc2ResourceSummary`
   - `fetchEc2CostRecommendations`
   - `fetchEc2SecuritySummary` + `fetchEc2SecurityFindings`
   - (optional) `listTenantAwsAccounts` if account missing
   This refreshes live **cost recommendations**, **security/governance scores**, **executive overview**, and **priority recommendations** on `index.html`.
4. `markEc2AsyncJobCompleted(jobId)` for reports page freshness (below).
5. EC2 JSON export uses the refreshed in-memory view model.

## Reports freshness (`reports.html`)

- **Reporting Engine** data comes from `/reports` via `listReports` / `getReport`. Live EC2 async jobs project reports during consumer **FINALIZING** with `reportSource: ec2_async` (see [EC2 async reporting](../architecture/ec2-async-reporting.md)).
- After EC2 job success on the Decision Dashboard, a **sessionStorage freshness signal** is set (`ec2-async-job-freshness.ts`).
- When the user opens **Reports**, `ReportsPage.initialize()` consumes the signal and calls `loadReports()` (authoritative backend list). A success message notes EC2 completion; **no fabricated report payloads**.
- Demo workflow reports (`reportSource: demo` or legacy rows) remain listed with explicit source labels; they are not substituted for live async reports.
- User can always click **Refresh** on Reports for a manual reload.

## Workflow panels (legacy)

The lower grid on `index.html` (evidence, governance, financial, confidence, recommendation, verification) is the **legacy synchronous workflow presentation**. It is **not** wired to EC2 async jobs. A **single** disclaimer in the overview panel directs users to live EC2 widgets above; other legacy panels show a minimal placeholder. **Analyze Environment does not call `/workflows/run`.**

## Stale / abandoned jobs in history

Backend durable status remains authoritative. Jobs left **`RUNNING`** after queue/worker exhaustion (high `retryCount` + `errorSummary`, no longer the active polled job) are shown in history as **Failed** via `ec2-async-job-history-display.ts` (display-only; does not mutate API status). New failures at SQS `maxReceiveCount` (5) are persisted as **`FAILED`** by the consumer.

## Zero-instance accounts after completion

When analysis completes with no EC2 instances, live panels should show **completed empty scope** (e.g. security/governance from persisted summaries with `instancesAnalyzed: 0`), not “analysis not yet run”. Executive summary uses persisted compliance score when security summary is available (0 for completed-empty scope, not a fabricated 100% recommendation confidence).

## Mock-provider candidate control

The hero **candidate** `<select>` is disabled and labeled as legacy; **`GET /providers/mock/instances` is not called** on authenticated Decision Dashboard init. Analyze does not depend on mock instances.

## Notifications

`AppNotifications.ts` — in-app toasts + hidden `aria-live="polite"` region. Transition-based: queued, started (discovery), completed, failed, retry available. No browser push permission.

## Authenticated no-mock rule

Async job progress, history, and analyze flow use real EC2 async APIs only. Demo/mock provider remains on `demo.html` and the Reports **Generate Demo Report** button (workflow path), not on EC2 async analyze.

## Known limitations

- `/events` timeline not shown in UI.
- Workflow report list includes EC2 async projections when FINALIZING succeeds; legacy demo rows remain with `reportSource` labels.
- Retry offered for all `FAILED` jobs without `failureRetryable`.
- User may start a new analysis while another job is still running (replaces active poll target).
- `GET` job polling does not cancel in-flight HTTP when `AbortController` aborts (signal checked after response).

## Production validation

1. Sign in, select verified AWS account and region.
2. Analyze Environment → 202, progress advances with consumer.
3. On success, live EC2 panels refresh once; export JSON reflects new data.
4. Open Reports → list reloads; EC2 completion message if signal consumed.
5. Failed job → retry creates new `jobId`; old row stays failed.
6. Confirm no tokens logged in browser console during normal use.
