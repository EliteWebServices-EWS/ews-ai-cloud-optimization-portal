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

There are **four** mock-provider workflow candidates in `backend/providers/mock/data/mockInstances.ts` plus **one** illustrative multi-instance snapshot—not four full dashboard scenarios historically wired to the demo page.

## How selection works

1. User picks a scenario from **Demo scenario**.
2. **Analyze Demo Environment** loads the matching view model via `PublicDemoEc2DashboardDataProvider` (in-browser fixtures aligned with mock data).
3. Progress states: **Ready → Analyzing demo scenario… → Completed** (synchronous; no SQS).
4. **Download SAMPLE REPORT (JSON)** exports the current scenario view model (filename includes scenario id).

## Data source

- Candidate scenarios: metadata and savings figures aligned with `MOCK_INSTANCES`, `MOCK_METRICS`, and `MOCK_RECOMMENDATIONS`.
- Fleet scenario: `buildCuratedEc2DemoViewModel()` synthetic fleet.
- **No** `fetch`, **no** `/analysis/ec2/start`, **no** tenant APIs on the demo page.

## Architecture distinction

```text
DEMO
  Demo scenario (selector)
    → Mock/demo view model (client-side provider)
    → Illustrative panels + SAMPLE JSON

LIVE
  Connected AWS account + region
    → POST /api/v1/analysis/ec2/start
    → SQS / Lambda consumer
    → FINALIZING report projection
    → ec2_async report in Reports
```

## Sample export

JSON is built from the active demo view model (`buildEc2JsonReport`). Watermarks and filenames indicate **SAMPLE / DEMO**. Demo exports are **not** written to the production Reports tenant table.
