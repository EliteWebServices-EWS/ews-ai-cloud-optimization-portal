# EC2 dashboard data modes

## Overview

| Mode | Route | Provider | Auth |
|------|-------|----------|------|
| Demo | `/dashboard/demo.html` | `PublicDemoEc2DashboardDataProvider` | None |
| Live | `/dashboard/index.html` | `LiveEc2DashboardDataProvider` | Cognito Bearer token |

Route selection determines the provider. Query parameters (for example `?mode=demo`) are **not** used as a security boundary on the live route.

## Shared view model

Both modes produce an `Ec2DashboardViewModel` consumed by shared EC2 widgets via `renderEc2DashboardPanels`.

## APIs (live only)

- `GET /api/v1/ec2/resources/summary?accountId=...&region=...`
- `GET /api/v1/recommendations/ec2/cost?accountId=...&region=...&limit=...`
- `GET /api/v1/aws-accounts` (account selector)

EC2 security recommendations are loaded from tenant-scoped APIs when analysis has been run:

- `GET /api/v1/security/ec2/summary?accountId=...` (account-wide aggregation)
- `GET /api/v1/security/ec2/summary?accountId=...&region=...` (single region)
- `GET /api/v1/recommendations/ec2/security`

Account-wide summary aggregates OPEN finding counts and scores across stored regional summaries. Prefix-list-only security group rules are never treated as confirmed secure in analysis.

Until analysis runs, the live UI shows **Security analysis not yet run** (not demo data).

## No live-to-demo fallback

Live load failures render `ERROR` / `PARTIAL` states. Demo curated data is never substituted on auth or API failure.

## Demo data

Curated synthetic data lives in `frontend/dashboard/src/demo/ec2-demo-data.ts`. Sample pricing is labelled **Sample cost estimate — not an AWS bill**.

## Testing

```bash
cd frontend && npm test -- src/ec2/ec2-dashboard.test.ts
```

## Production validation

See `docs/validation/ec2-dashboard-validation.md`.
