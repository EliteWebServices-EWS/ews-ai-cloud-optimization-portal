# Workflow demo report generation

Production Reports must not expose mock workflow report generation unless operators explicitly enable it.

## Backend

| Setting | Source | Default |
|--------|--------|---------|
| `WORKFLOW_DEMO_REPORTS_ENABLED` | Lambda env (`WorkflowDemoReportsEnabled` SAM parameter) | `false` |

When `PROVIDER_MODE` is `mock` and `WORKFLOW_DEMO_REPORTS_ENABLED` is not `true`:

- `POST /api/v1/reports/generate` returns **403** (`DEMO_REPORTS_DISABLED`)

`POST /api/v1/workflows/run` remains available for mock-provider workflow orchestration (smoke tests, API clients). It does not persist optimization reports by itself.

When `PROVIDER_MODE` is `aws`, report generation is not gated by this flag (non-demo workflow reports).

`GET /api/v1/health` includes:

```json
{
  "features": {
    "workflowDemoReports": false
  }
}
```

## Frontend

The Reports page calls `/health` on load. When `workflowDemoReports` is `false`:

- **Generate Demo Report** is hidden
- The workflow demo badge in the header is hidden

Historical demo rows remain visible and labeled **Demo workflow**. Live EC2 async reporting is unchanged.

## Enabling demo generation (non-production / demos only)

SAM deploy example:

```bash
sam deploy ... --parameter-overrides WorkflowDemoReportsEnabled=true
```

Or add `WorkflowDemoReportsEnabled="true"` to `backend/samconfig.toml` `parameter_overrides` for a dedicated demo stack only.
