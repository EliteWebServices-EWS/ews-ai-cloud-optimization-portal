# EC2 dashboard runbook

## Public demo

1. Open `/dashboard/demo.html` without signing in.
2. Confirm **DEMO DATA** badge and illustrative notice.
3. Confirm no `Authorization` headers (browser network tab).
4. Optional: download **SAMPLE REPORT (JSON)** — watermark in payload.

## Authenticated live

1. Sign in via Cognito; open `/dashboard/index.html`.
2. Confirm **LIVE AWS DATA** badge and masked account suffix.
3. Select AWS account and region; use **Retry EC2 load** after errors.
4. Zero-instance accounts must show `0` instances (no minimum counts).
5. Export **EC2 JSON report** from live view model only.

## Rollback

Revert frontend deploy artifact to prior `dashboard-dist` build. No backend or IAM changes are required for this separation.

## PDF reports

PDF export for EC2-specific live reports is **not** available; JSON export from the live view model is supported on the Decision Dashboard.
