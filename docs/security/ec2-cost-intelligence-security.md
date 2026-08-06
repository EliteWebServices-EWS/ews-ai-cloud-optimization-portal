# EC2 Cost Intelligence Security

## Customer IAM (AssumeRole role)

Required for metric collection:

- `cloudwatch:GetMetricData` on `*` (CloudWatch API constraint; customer role only)

Do **not** grant the platform Lambda role direct customer CloudWatch access.

## Platform IAM

No `cloudwatch:*` on `SisumLambdaExecutionRole`. No EC2 mutation actions.

## RBAC

| Action | Roles |
|--------|--------|
| Start analysis | `tenant_owner`, `tenant_admin`, `analyst` |
| List/view recommendations | `tenant_owner`, `tenant_admin`, `analyst`, `viewer`, `auditor` |

`security_admin` is excluded from cost analysis start and read APIs unless product policy changes.

## Data handling

Audit events exclude credentials, ExternalId, session tokens, and raw CloudWatch datapoints. APIs return summarized recommendations only.

## Resolution safety

Partial metric, batch, or regional failures do not resolve prior OPEN recommendations.

## Pricing data

Catalog rates in `ec2-on-demand-pricing-catalog.ts` are **controlled sample values** for deterministic tests (catalog id `2026-08-01-ec2-cost-v1`), not live AWS Price List API quotes. Recommendations use `pricingStatus: CONTROLLED_CATALOG_SAMPLE` when a catalog rate exists; otherwise `UNAVAILABLE`. Sample estimates must not be treated as verified customer billing savings or rolled into validated executive savings totals.

Production: `EC2_COST_SAMPLE_PRICING_ENABLED=false` (see `backend/template.yaml`) suppresses sample dollar amounts in API responses unless explicitly enabled for approved demo environments.

## Tenant isolation

Tenant ID is taken from trusted request context only. Cross-tenant reads return safe 404.
