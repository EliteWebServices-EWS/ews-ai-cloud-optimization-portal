# EC2 dashboard validation

## Automated

From `frontend/`:

```bash
npm ci
npm test
npm run build
```

Focused:

```bash
npm test -- src/ec2/ec2-dashboard.test.ts
```

## Manual — public demo

1. Load `/dashboard/demo.html` logged out.
2. DEMO DATA badge + illustrative notice present.
3. No authenticated API calls.
4. SAMPLE REPORT JSON download labelled.

## Manual — live

1. Sign in; load `/dashboard/index.html`.
2. LIVE AWS DATA badge; no DEMO DATA badge.
3. Account selector populated from `/api/v1/aws-accounts`.
4. Zero EC2 instances display honestly (0 running/stopped).
5. Force API error → error banner; no demo numbers.
6. Live JSON export contains account suffix and timestamps only (no demo watermark).

## Known limitations

- EC2 security section unavailable on live route until backend hardening.
- Live monthly cost breakdown may be unavailable when pricing is not returned by API.
- Workflow section below EC2 still uses mock workflow provider (separate from EC2 live data).
