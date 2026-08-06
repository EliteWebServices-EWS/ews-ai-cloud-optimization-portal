# EC2 dashboard data separation

## Boundaries

- **Public demo** must not contain real tenant IDs, account IDs, instance IDs, VPC/subnet IDs, tokens, or production API fixtures.
- **Live dashboard** must not log bearer tokens, place tokens in URLs, or fall back to demo values on 401/403/5xx.

## Implementation

- Demo: `frontend/dashboard/src/demo/` (no `fetch`).
- Live: `frontend/dashboard/src/live/` (Bearer token + tenant-scoped APIs only).
- Shared widgets read mapped props from `Ec2DashboardViewModel` only.

## Security engine dependency

`GET /api/v1/recommendations/ec2/security` is process-local and not tenant-safe; the live UI shows **Security analysis unavailable** instead of demo findings.
