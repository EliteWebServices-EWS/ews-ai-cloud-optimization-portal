# Execution performance report

Date: 2026-07-30
Branch: `feature/execution-validation`

## Test environment

- Host: local Windows development machine
- Node.js: v24.18.0
- Persistence: in-memory mock repositories (`createInMemoryExecutionStores`)
- AWS: mocked EC2 client (no network)
- Iterations: `EXECUTION_VALIDATION_ITERATIONS=50` (configurable; default from helper is 50)

## Methodology

`tests/performance/execution-performance.test.ts` loops `resolveIterationCount()` times and records `performance.now()` deltas for:

1. Orchestrator VALIDATION mode (EC2 START_INSTANCE)
2. Execution plan create
3. Execution history append

Stats computed in `tests/helpers/execution-metrics.ts`: min, max, mean, p50, p95, p99, sample count, successes, failures.

## Measured results (local run)

### validation (orchestrator VALIDATION mode)

| Metric | ms |
| --- | ---: |
| sampleCount | 50 |
| successes | 50 |
| failures | 0 |
| min | 0.031 |
| max | 4.005 |
| mean | 0.203 |
| p50 | 0.083 |
| p95 | 0.259 |
| p99 | 4.005 |

### plan-create

| Metric | ms |
| --- | ---: |
| sampleCount | 50 |
| successes | 50 |
| failures | 0 |
| min | 0.051 |
| max | 4.969 |
| mean | 0.195 |
| p50 | 0.089 |
| p95 | 0.177 |
| p99 | 4.969 |

### history-append

| Metric | ms |
| --- | ---: |
| sampleCount | 50 |
| successes | 50 |
| failures | 0 |
| min | 0.030 |
| max | 0.421 |
| mean | 0.059 |
| p50 | 0.050 |
| p95 | 0.093 |
| p99 | 0.421 |

## Pagination metrics

Scoped pagination behavior is covered in integration and existing mock repository unit tests (token scope, no duplicate/missing items in mocked lists). No separate latency benchmark for pagination in this sprint.

## Conditional-write metrics

Concurrency tests record successful vs rejected stale updates qualitatively; no aggregated latency series for conflicts in the performance script.

## Limitations

- Sample size 50 is suitable for CI smoke timing only.
- Does not measure DynamoDB latency, cold Lambda, or real AWS API round trips.
- Does not include PRODUCTION orchestration path (persist + verify + rollback) in the performance loop.

## Recommendations

- Increase `EXECUTION_VALIDATION_ITERATIONS` in dedicated perf jobs (not PR gates) if trend analysis is needed.
- Add optional DynamoDB Local leg to performance workflow when execution-run table CI setup exists.
- Define SLOs only after staging measurements with real persistence and representative action mix.
