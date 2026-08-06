# EC2 Cost Analysis Runbook

## On-demand analysis

1. Ensure EC2 discovery has populated inventory for the target account (Engineer 1).
2. Confirm AWS account status is **VERIFIED**.
3. `POST /api/v1/analysis/ec2/cost` with `accountId`, optional `regions` (max 3), optional `observationDays` (1–30, default 14).

## Limits

- Max **100** ACTIVE instances per request.
- Default **1** region (account home); max **3** regions.
- CloudWatch period **3600** seconds; `GetMetricData` queries are split into bounded batches (max **500** `MetricDataQueries` per request). Each batch paginates with its own **NextToken**; results merge without overwriting datapoints.
- **100** standard instances → up to **500** queries → **1** batch call per region (plus NextToken pages). **100** burstable instances → **900** queries → **2** batch calls per region.
- Zero ACTIVE instances: **no CloudWatch calls** (verified in production test path).

## Empty-state (account 572262081497)

Expect `instancesFound = 0`, `instancesEvaluated = 0`, no CloudWatch traffic.

## Resolution

OPEN recommendations are cleared only after a **SUCCEEDED** cost analysis covering the same account and requested regions. **PARTIAL** (e.g. CloudWatch failure in one region) leaves existing findings unchanged.

## Volume attachments

If STOPPED_WITH_STORAGE findings are missing after discovery, rerun **EC2 discovery** so volume `attachments` metadata is populated, then rerun cost analysis.

## Rollback

Disable routes by reverting deployment; persisted recommendations remain in `SisumCloudResourcesTable` under `EC2_COST_*` sort key prefixes. No AWS resources are modified by this feature.

## Operational notes

- Partial metric failures (including a failed query batch) yield run status **PARTIAL** with sanitized warnings and **do not resolve** OPEN recommendations.
- Failed runs do **not** auto-resolve open recommendations.
- Malformed API inputs return **422 INVALID_REQUEST**; clients never see persistence-layer validation errors.
- Sample catalog estimates are **not** billing guarantees. With `EC2_COST_SAMPLE_PRICING_ENABLED=false` (production default), list/get responses omit sample dollar fields; executive **validated** savings totals must not include catalog samples (`savingsSummary.validatedMonthlySavings` only counts `VERIFIED_RATE`).
