# EC2 Cost Intelligence Validation

## Automated tests

```bash
cd backend
npm run test:ec2-cost-intelligence
```

Focused suite covers resolution semantics, volume attachments, CloudWatch batching/pagination merge, rules, controlled-catalog pricing language, API validation (422 contract), pricing policy, HTTP/RBAC matrix, and infrastructure guardrails (see `tests/unit/ec2-cost-*.test.ts`, `tests/integration/ec2-cost-api-http*.test.ts`, and `tests/integration/ec2-cost-api-validation-http.test.ts`).

## Production validation (no chargeable EC2 required)

Preconditions: verified account **572262081497**, EC2 discovery validated, **zero** INSTANCE inventory rows.

1. Obtain access token.
2. `POST /api/v1/analysis/ec2/cost` body: `{ "accountId": "572262081497", "regions": ["us-east-1"], "observationDays": 14 }`.
3. Expect HTTP **200**, status **SUCCEEDED**, `instancesFound = 0`, `instancesEvaluated = 0`, zero recommendations.
4. Confirm no CloudWatch `GetMetricData` in customer account (CloudWatch API logs / absence of new metric requests).
5. `GET /api/v1/recommendations/ec2/cost?accountId=572262081497` → empty list.
6. Confirm no EC2/EBS mutations.

Live-metric validation with running instances may be performed separately under change control.

## API validation expectations

- Malformed `accountId`, `region`, filters, limits, or oversized pagination tokens → **422** `INVALID_REQUEST`, stage `ec2-cost-api`.
- Unknown server failures → **500** `ENGINE_ERROR` with fixed public message (no stack traces or persistence errors).

## Pricing safety expectations

- Catalog-backed recommendations → `pricingStatus: CONTROLLED_CATALOG_SAMPLE` with `catalogVersion` and `priceEffectiveDate`.
- Production default (`EC2_COST_SAMPLE_PRICING_ENABLED=false`) → API omits sample `estimatedMonthlySavings` / `estimatedAnnualSavings`.
- `savingsSummary.validatedMonthlySavings` excludes catalog samples.

## Quality gates

From `backend`: `npm ci`, `npm test`, `npm run build`, `sam validate --lint`, `sam build --no-cached`. From repo root: `git diff --check`.
