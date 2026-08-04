# EC2 discovery validation

**Branch (production evidence):** `docs/ec2-discovery-production-validation`
**Sprint:** 14 — Engineer 1 (EC2 Discovery & Inventory Foundation)

## Automated

- `backend/tests/unit/ec2-discovery-engine.test.ts` — normalization, repository upsert/stale rules, region limits, route order, SAM table.
- `backend/tests/unit/ec2-cloud-resource-pagination.test.ts` — scoped list `nextToken` encoding and rejection of malformed or cross-tenant/account tokens.
- `backend/tests/integration/ec2-discovery-conflict-http.test.ts` — optimistic-lock conflicts return **409** with code `CONFLICT` (sanitized; no DynamoDB internals).
- `backend/tests/integration/ec2-discovery-error-sanitization.test.ts` — unknown failures return generic **500**; internal details logged server-side only.
- Full backend CI: `npm test`, `npm run build`, `sam validate --lint`.

## API error conventions (EC2)

- **409 `CONFLICT`**: `RepositoryConflictError` from inventory upserts or discovery-run completion (optimistic locking). Message is generic (`Resource version conflict.`); clients may retry the operation.
- **422 `INVALID_REQUEST`**: Malformed list filters or pagination tokens. List tokens are scoped to tenant, AWS account, and optional region/resourceType filters; unscoped or cross-scope tokens are rejected.
- **500 `ENGINE_ERROR`**: Unexpected internal failures return a fixed public message only; operators use structured server logs (request/correlation IDs, operation, error name) — not the HTTP body — for diagnosis.

## Manual (non-destructive)

1. Use production/staging API with verified account.
2. `POST /api/v1/aws-accounts/{accountId}/ec2/discovery` with single region.
3. Confirm **200**, run status `SUCCEEDED` or `PARTIAL`, counts present.
4. `GET /api/v1/ec2/resources?accountId=...` returns normalized items with `firstSeenAt` / `lastSeenAt`.
5. Confirm no credentials in JSON responses.

## Out of scope (Engineer 1)

- Cost Explorer, Compute Optimizer, Config, metrics.
- Cost, performance, security, and recommendation analysis (future sprints may consume persisted inventory).

---

## Production validation (Sprint 14 Engineer 1)

**Validation date:** 2026-08-04
**Environment:** Production (`sisum-backend` stack, `us-east-1`)
**Validation type:** Live API against verified customer test account (same platform/customer pairing as Sprint 13)

### Environment and accounts

| Item | Value |
|------|--------|
| Production API base | `https://zqe6cl0m15.execute-api.us-east-1.amazonaws.com` |
| CloudFormation stack | `sisum-backend` |
| Platform AWS account | `739275446782` |
| Customer / test AWS account | `572262081497` |
| Validated tenant ID | `tenant-msddsjji-n270imrc` |
| Cloud resources table | `sisum-cloud-resources-production` |
| Validated region | `us-east-1` |

### Preconditions

| Check | Status |
|-------|--------|
| Tenant active; owner membership and JWT tenant claim aligned (Sprint 13) | **PASSED** (inherited) |
| AWS account `572262081497` registered and **VERIFIED** | **PASSED** |
| Customer role includes EC2 Describe actions (see [security doc](../security/ec2-discovery-security.md)) | **PASSED** |
| `sisum-cloud-resources-production` table deployed and **ACTIVE** | **PASSED** |
| Valid authenticated access token for tenant-scoped EC2 routes | **PASSED** |
| No long-lived customer access keys in platform | **PASSED** |

### Deployment-role IAM issue and recovery

| Step | Detail | Status |
|------|--------|--------|
| First deployment attempt | CloudFormation update failed: `SisumBackendDeployRole` could not `dynamodb:DescribeTable` on `sisum-cloud-resources-production` | **RESOLVED** |
| Root cause | The **live** inline policy `SisumBackendDeployDynamoDBPolicy` did not include the new table ARN pattern. Repository IAM JSON already listed `arn:aws:dynamodb:us-east-1:739275446782:table/sisum-cloud-resources-*`; **repository files do not automatically update the live IAM role**. | **RESOLVED** |
| Not the cause | EC2 runtime code, API contracts, or customer AssumeRole path | **NOT APPLICABLE** |
| Recovery | Approved admin path: update **live** inline policy to include `arn:aws:dynamodb:us-east-1:739275446782:table/sisum-cloud-resources-*` | **RESOLVED** |
| Pre-rerun check | IAM policy simulation on deploy principal: `CreateTable`, `DescribeTable`, `UpdateTable`, `DeleteTable` on cloud-resources table pattern — **allowed** | **PASSED** |
| Rollback behavior | Failed stack update rolled back safely; table **not** left behind after rollback | **PASSED** |
| Rerun | Deployment completed successfully after live policy update | **PASSED** |

### Stack and table validation

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Stack status | `UPDATE_COMPLETE` | `UPDATE_COMPLETE` | **PASSED** |
| Table status | `ACTIVE` | `ACTIVE` | **PASSED** |
| Billing mode | `PAY_PER_REQUEST` | `PAY_PER_REQUEST` | **PASSED** |

### EC2 discovery request

`POST /api/v1/aws-accounts/572262081497/ec2/discovery`

```json
{
  "regions": ["us-east-1"]
}
```

### Discovery response summary

| Field | Value | Status |
|-------|-------|--------|
| HTTP status | 200 | **PASSED** |
| `success` | `true` | **PASSED** |
| Run status | `SUCCEEDED` | **PASSED** |
| `runId` | `ec2run-c07a573c-8dbd-4cd6-80c3-672f8bfa68a1` | **PASSED** |
| `regions` | `us-east-1` | **PASSED** |
| `regionsSucceeded` | `us-east-1` | **PASSED** |
| `regionsFailed` | (none) | **PASSED** |
| `warnings` | (none) | **PASSED** |
| `resourceCounts` | `NETWORK_INTERFACE`: 1 | **PASSED** |

No EC2 **instances** were reported in `resourceCounts` (see empty-instance interpretation below).

### Resource inventory result

`GET /api/v1/ec2/resources?accountId=572262081497&region=us-east-1&limit=50`

| Check | Result | Status |
|-------|--------|--------|
| HTTP status | 200 | **PASSED** |
| Items returned | 1 normalized resource | **PASSED** |
| `resourceType` | `NETWORK_INTERFACE` | **PASSED** |
| `resourceId` | `eni-0264747d7a24d53c9` | **PASSED** |
| `service` | `ec2` | **PASSED** |
| `region` | `us-east-1` | **PASSED** |
| `tenantId` | `tenant-msddsjji-n270imrc` | **PASSED** |
| `accountId` | `572262081497` | **PASSED** |
| `status` | `ACTIVE` | **PASSED** |
| `version` | 1 | **PASSED** |
| `metadata.status` | `in-use` | **PASSED** |
| `metadata.vpcId` | `vpc-****` (redacted in docs) | **PASSED** |
| `metadata.subnetId` | `subnet-****` (redacted in docs) | **PASSED** |
| Private IP | Present in API; **redacted in documentation** | **PASSED** |
| `firstSeenAt` / `lastSeenAt` / `discoveredAt` | Present | **PASSED** |
| `tags` | `[]` | **PASSED** |

### Summary endpoint result

`GET /api/v1/ec2/resources/summary?accountId=572262081497&region=us-east-1`

| Field | Value | Status |
|-------|-------|--------|
| HTTP status | 200 | **PASSED** |
| `totalResources` | 1 | **PASSED** |
| `resourcesByType.NETWORK_INTERFACE` | 1 | **PASSED** |
| `instancesByState` | `{}` | **PASSED WITH EXPECTED EMPTY STATE** |
| `instancesByRegion` | `{}` | **PASSED WITH EXPECTED EMPTY STATE** |
| `instancesByInstanceType` | `{}` | **PASSED WITH EXPECTED EMPTY STATE** |
| `staleResourceCount` | 0 | **PASSED** |
| `latestSuccessfulDiscoveryAt` | `2026-08-04T14:20:03.574Z` | **PASSED** |

### Empty-EC2 interpretation

The validated account had **no running or stopped EC2 instances**. That is **not** a failure.

This run demonstrates:

- Authentication, tenant RBAC, and verified account lookup
- STS AssumeRole and EC2 Describe APIs
- Normalization and DynamoDB persistence
- List and summary APIs
- Expected behavior when instance inventory is empty but other EC2-family resources exist (**one** `NETWORK_INTERFACE` discovered)

### Security observations

| Observation | Status |
|-------------|--------|
| Responses contained no access tokens, External ID, or temporary AWS credentials | **PASSED** |
| No raw AWS SDK `$metadata` or internal persistence errors in API bodies (per Engineer 1 hardening) | **PASSED** |
| Tenant and account IDs in responses matched trusted caller context | **PASSED** |
| Least-privilege IAM proof for customer EC2 policy (beyond Describe list) | **NOT VERIFIED** (out of Engineer 1 scope) |

### Persistence observations

| Observation | Status |
|-------------|--------|
| Resource row created with `version` 1 | **PASSED** |
| Discovery run recorded (`SUCCEEDED`) | **PASSED** |
| Query-scoped list by tenant + account + region | **PASSED** |
| Summary aggregation matches persisted count | **PASSED** |

### Production evidence matrix

| Validation area | Expected result | Actual result | Status | Evidence |
|-----------------|-----------------|---------------|--------|----------|
| Stack status | `UPDATE_COMPLETE` after successful deploy | `UPDATE_COMPLETE` | **PASSED** | CloudFormation |
| Table status | `ACTIVE` | `ACTIVE` | **PASSED** | DynamoDB |
| Billing mode | `PAY_PER_REQUEST` | `PAY_PER_REQUEST` | **PASSED** | DynamoDB |
| Deployment IAM | Deploy role can manage cloud-resources table | Live policy updated; simulation allowed CRUD describe paths; rerun succeeded | **RESOLVED** | IAM simulation + deploy |
| HTTP authentication | Authenticated tenant caller | 200 on discovery and reads | **PASSED** | API calls |
| Tenant authorization | EC2 discovery roles enforced | Discovery and list succeeded for owner context | **PASSED** | API calls |
| AssumeRole | Temporary credentials for customer account | Discovery **SUCCEEDED** without credential fields in response | **PASSED** | Discovery run |
| Regional discovery | `us-east-1` completed | `regionsSucceeded`: `us-east-1` | **PASSED** | Discovery JSON |
| Resource normalization | Stable EC2 inventory shape | One `NETWORK_INTERFACE` with metadata and timestamps | **PASSED** | List API |
| DynamoDB persistence | Rows under tenant+account keys | `version` 1; summary `latestSuccessfulDiscoveryAt` set | **PASSED** | List + summary |
| Inventory API | Tenant-scoped list | One item; correct `tenantId` / `accountId` | **PASSED** | List API |
| Summary API | Aggregates by type | `NETWORK_INTERFACE`: 1; instance maps empty | **PASSED** | Summary API |
| Stale count | 0 after successful run | `staleResourceCount`: 0 | **PASSED** | Summary API |
| Instance-empty behavior | No instances without failing run | No `INSTANCE` in counts; ENI still discovered | **PASSED WITH EXPECTED EMPTY STATE** | Discovery + summary |
| Warning handling | None when regions succeed | `warnings`: none | **PASSED** | Discovery JSON |
| Secret leakage | No secrets in responses | No tokens/External ID/credentials in captured JSON | **PASSED** | Manual review |

### Final production verdict

**Engineer 1 — EC2 Discovery & Inventory Foundation**

| Milestone | Status |
|-----------|--------|
| Implementation complete | **PASSED** |
| Automated validation complete | **PASSED** |
| Deployment complete | **PASSED** (after deploy-role IAM recovery) |
| Production validation complete | **PASSED** |

The production-validated account had **no EC2 instances**; **one network interface** (`NETWORK_INTERFACE` = 1) was discovered and persisted. Cost, performance, security, and recommendation analysis remain **out of scope** for Engineer 1. Future EC2 analysis features can consume this persisted inventory.

### Remaining limitations

- Synchronous discovery only (no job queue).
- Customer IAM may still use broad read policies until narrowed per Sprint 13 guidance.
- Least-privilege **proof** for EC2 Describe policy not automated in this sprint.
- Instance-empty accounts still surface other EC2 resource types (as validated with ENI).
- Retention/TTL for stale `NOT_SEEN` rows not part of this validation.

---

## Related documentation

- [EC2 discovery runbook](../operations/ec2-discovery-runbook.md)
- [EC2 discovery security](../security/ec2-discovery-security.md)
- [EC2 discovery plugin architecture](../architecture/ec2-discovery-plugin.md)
- [Sprint 13 production validation](./sprint-13-production-validation-report.md) (platform and account foundation)
