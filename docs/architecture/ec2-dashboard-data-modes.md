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

EC2 security recommendations are **not** wired on the live dashboard until tenant-scoped persistence is available (Engineer 3).

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
