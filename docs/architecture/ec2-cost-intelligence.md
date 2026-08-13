# EC2 Cost Intelligence Architecture

Engineer 2 consumes **Engineer 1 durable EC2 inventory** in `SisumCloudResourcesTable` (INSTANCE and VOLUME). It does **not** call `DescribeInstances` or rediscover resources.

## Flow

Stored inventory → instance/volume selection → bounded CloudWatch `GetMetricData` batches (AssumeRole, max 500 queries per request, independent NextToken per batch) → normalized performance evidence → versioned EC2 cost rules → explainable findings → durable recommendations → tenant-scoped APIs.

## Separation

- **Engineer 1**: discovery and inventory persistence (`backend/cloud-intelligence/plugins/ec2/`).
- **Engineer 3**: security/governance (`backend/engines/ec2-security/`) — client-posted inventory; no overlap.
- **Legacy plugin**: `backend/plugins/ec2/ec2.plugin.ts` — ProviderInterface workflow; unchanged.

## Components

| Layer | Location |
|-------|----------|
| Limits | `backend/cloud-intelligence/ec2-cost/ec2-cost-limits.ts` |
| CloudWatch port/adapter | `ec2-performance-metrics-client.port.ts`, `aws-cloudwatch-ec2-metrics-client.ts` |
| STS factory | `ec2-cost-cloudwatch-factory.ts` |
| Rules + registry | `ec2-cost-rules.ts`, `ec2-cost-rule-registry.ts` |
| Orchestrator | `ec2-cost-analysis-orchestrator.ts` |
| API service | `backend/services/ec2-cost-analysis-api-service.ts` |
| Persistence keys | `backend/database/cloud-resources/ec2-cost-keys.ts` |
| Evidence observation keys | `backend/database/cloud-resources/evidence-observation-keys.ts` |
| Longitudinal evidence (Sprint 1) | `backend/persistence-intelligence/`, `backend/services/evidence-persistence-service.ts` — see [sprint-1-persistence-intelligence.md](./sprint-1-persistence-intelligence.md) |
| Repositories | `mock-ec2-cost-repository.ts`, `dynamodb-ec2-cost-repository.ts`, `mock-evidence-observation-repository.ts`, `dynamodb-evidence-observation-repository.ts` |

## Advisory-only

Recommendations never mutate AWS resources. CPU metrics cannot prove memory fit; guest memory is not available from standard AWS/EC2 metrics.

## Resolution semantics (production)

- **FAILED** and **PARTIAL** analysis runs never auto-resolve OPEN recommendations.
- Only **SUCCEEDED** runs where **all requested regions** completed successfully may resolve OPEN findings absent from the current rule evaluation.
- Findings with a **rule version mismatch** (older `ruleVersion`) are not resolved automatically.
- **ACKNOWLEDGED** and **DISMISSED** lifecycle states are preserved across upserts; **RESOLVED** reopens to **OPEN** when the same issue recurs.

## Volume attachments

Cost analysis reads `metadata.attachments[]` on `VOLUME` records (see EC2 discovery plugin doc). Stopped-instance storage findings require attachment metadata; in-use volumes without attachments yield **INSUFFICIENT_DATA**, not silent pass.

## Cost Explorer / Compute Optimizer

Out of scope. Pricing uses a small versioned on-demand **controlled catalog** (`ec2-on-demand-pricing-catalog.ts`) with `pricingSource: CONTROLLED_CATALOG_SAMPLE` — advisory estimates, not live AWS billing rates.

## Empty inventory

When no ACTIVE INSTANCE records exist: HTTP 200, `SUCCEEDED`, zero recommendations, **no CloudWatch calls** (production validation path).

## CloudWatch batching

- Central limit: `EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST` (**500**, AWS `GetMetricData` maximum).
- Queries are split into stable batches; each batch follows its own NextToken pagination; datapoints merge with timestamp deduplication before statistics.
- A failed batch contributes to **PARTIAL**/**FAILED** run status; such runs never auto-resolve OPEN recommendations.

## API validation

Request-controlled fields (`accountId`, `regions`, list filters, pagination tokens, limits) are validated in `ec2-cost-api-validation.ts` **before** repository or persistence key helpers run. Malformed values return **HTTP 422** with `INVALID_REQUEST` and stage `ec2-cost-api`. Persistence validator internals are never exposed to clients.

## Pricing status model

| `pricingStatus` | Meaning |
|-----------------|--------|
| `VERIFIED_RATE` | Reserved for future verified billing rates (not used by the current catalog). |
| `CONTROLLED_CATALOG_SAMPLE` | Deterministic catalog sample used for tests/demos; advisory only. |
| `UNAVAILABLE` | Unsupported region/type or missing catalog entry — no fallback to another region. |

Catalog-backed findings include `pricingAssumptions.catalogVersion` and `priceEffectiveDate`. List responses include `savingsSummary.validatedMonthlySavings` (VERIFIED_RATE only) and `sampleEstimateMonthlySavings` (only when `EC2_COST_SAMPLE_PRICING_ENABLED=true`). Production Lambda sets that flag to **false** by default so sample dollar amounts are omitted from API payloads.

See also: `docs/operations/ec2-cost-analysis-runbook.md`, `docs/security/ec2-cost-intelligence-security.md`, `docs/validation/ec2-cost-intelligence-validation.md`.
