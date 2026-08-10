# EC2 Demo Dashboard

## Purpose

The public **EC2 Demo Dashboard** (`/dashboard/demo.html`) is a sales and education surface. It runs **deterministic mock scenarios** only. It does **not** connect to customer AWS accounts, STS, or the live EC2 async pipeline.

The authenticated **Decision Dashboard** (`/dashboard/index.html`) is separate: account + region driven, `POST /api/v1/analysis/ec2/start`, SQS/Lambda consumer, and `ec2_async` reports.

## Available scenarios

| Scenario ID | Label | Source |
|-------------|-------|--------|
| `i-mock-001` | web-server-01 · i-mock-001 | Backend mock provider instance + recommendation |
| `i-mock-002` | dev-api-01 · i-mock-002 | Backend mock provider instance + recommendation |
| `i-mock-003` | staging-worker · i-mock-003 | Backend mock provider instance (no mock resize rec) |
| `i-mock-004` | analytics-batch · i-mock-004 | Backend mock provider instance + recommendation |
| `illustrative-fleet` | Illustrative multi-instance fleet | Frontend curated snapshot (`i-demo-ec2-*`) |

There are **four** mock-provider workflow candidates in `backend/providers/mock/data/mockInstances.ts` plus **one** illustrative multi-instance snapshot.

## Analyze Demo Environment

1. User picks a scenario from **Demo scenario**.
2. **Analyze Demo Environment** loads the matching EC2 view model and **decision-intelligence snapshot** via `PublicDemoEc2DashboardDataProvider` (in-browser fixtures aligned with mock data).
3. UI states: **Ready → Analyzing demo scenario… → Completed** (short delay for presentation; **not** production SQS/Lambda).
4. **Download SAMPLE REPORT (JSON)** exports the active scenario (includes a compact `decisionIntelligence` block when present).

## SISU'M Decision Intelligence (demo)

After analysis, the page shows:

### Workflow progress (demonstration only)

Eight stages with text state labels (not color-only):

1. Evidence Collection
2. Governance Evaluation
3. Financial Analysis
4. Confidence Analysis
5. Recommendation Analysis
6. Execution Simulation
7. Verification
8. Learning Store

Stages complete synchronously in the browser for presentation. This is **not** the production async job pipeline.

### Decision panels

Reuses existing dashboard components where possible:

- Optimization Candidate
- Evidence Status
- Governance Status
- Financial Impact
- Confidence Intelligence (**recommendation** confidence from mock fixtures — not compliance score)
- Recommendation
- Verification Result (**SIMULATED / NOT EXECUTED** — no AWS change)

**Learning Store:** “Demo learning outcome prepared — not persisted to the production Learning Store.”

Governance and confidence values are **illustrative** and labeled as such; backend engines do not execute on the public demo page.

### Demo Report Preview

Compact executive/savings/recommendation/verification summary for the analyzed scenario — not the authenticated Reports page.

## Strict live/demo isolation

- No authentication
- No `fetch` to production APIs
- No `POST /analysis/ec2/start`, `/workflows/run`, or `/reports/generate`
- No STS, AssumeRole, SQS, DynamoDB, or customer AWS calls
- No persistence to production Reports or Learning Store

## Architecture distinction

```text
DEMO
  Demo scenario
    → Mock/demo view model + decision snapshot (client-side)
    → Workflow progress (illustrative)
    → Decision panels + EC2 widgets
    → Demo Report Preview + SAMPLE JSON

LIVE
  Connected AWS account + region
    → POST /api/v1/analysis/ec2/start
    → SQS / Lambda consumer
    → FINALIZING report projection
    → ec2_async report in Reports
```

## Sample export

JSON is built from the active demo view model (`buildEc2JsonReport`). Watermarks and filenames indicate **SAMPLE / DEMO**. Demo exports are **not** written to the production Reports tenant table.
