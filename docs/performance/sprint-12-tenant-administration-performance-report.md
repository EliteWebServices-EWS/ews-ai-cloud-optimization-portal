# Sprint 12 — Tenant Administration Performance Report

## Test environment

- OS: Windows / CI Ubuntu (workflow)
- Runtime: Node.js 24
- Persistence: **In-memory** mock tenant/membership repositories (not DynamoDB Local)
- Measurement API: `performance.now()`

## Methodology

1. Warm-up: 5 GET requests before sampling.
2. Sampled: 20 GET `/api/v1/admin/tenants/{id}` requests.
3. Recorded: min, mean, p50, p95, p99, max (milliseconds).
4. Separate single-sample POST create tenant (with MFA headers).

## Representative results (local, informational)

Example stdout from `performance-validation.test.ts`:

```text
[sprint12-perf] tenant-get local samples={"sampleCount":20,"minMs":~7.5,"meanMs":~12.5,"p50Ms":~10.7,"p95Ms":~17.2,"p99Ms":~35.2,"maxMs":~35.2}
```

These numbers reflect **local Express + in-memory** latency only.

## Limitations

- Not representative of AWS Lambda cold start, API Gateway, or DynamoDB on-demand latency.
- No load test; no concurrency saturation.

## Production load-test recommendations

- Execute read-heavy tenant list/get and membership list against staging tables with realistic item counts.
- Measure p95/p99 with 50+ concurrent administrators (bounded soak test).
- Compare optimistic-lock conflict rate under parallel patch workloads.

## Proposed indicators (not formal SLOs)

| Operation | Local p50 (observed) | Staging target (TBD) |
| --- | --- | --- |
| Tenant GET | ~11 ms | < 200 ms |
| Tenant PATCH | Similar order | < 300 ms |
| Membership list page | Not measured this sprint | < 300 ms |

Formal SLOs require product and platform approval.
