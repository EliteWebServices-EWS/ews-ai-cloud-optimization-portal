# EC2 security & governance — production validation

## Prerequisites

- Verified AWS account connected for the tenant
- Customer integration role grants **`ec2:DescribeSecurityGroups`** (and other EC2 discovery reads in `docs/security/ec2-discovery-security.md`); re-run account verification after policy updates
- EC2 discovery has populated `CLOUD_RESOURCES_TABLE_NAME` (or local mock in test)
- Cognito user with `security_admin` or `analyst` for analysis; `viewer` for read APIs

## Customer role rollout (existing tenants)

1. Add **`ec2:DescribeSecurityGroups`** to the customer integration role (exact action).
2. Reverify the AWS account (`permissionReport.allGranted` must be true).
3. Rerun EC2 discovery to backfill ingress and IMDS evidence.
4. Run EC2 security analysis.
5. Validate findings and dashboard scores.

## API validation

### Start analysis

```http
POST /api/v1/analysis/ec2/security
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "accountId": "<verified-account-id>",
  "regions": ["us-east-1"]
}
```

Expect `200`, persisted run metadata, summary scores when instances exist. Request body must not include `tenantId`, inventory, findings, or caller-supplied scores.

### List findings

```http
GET /api/v1/recommendations/ec2/security?accountId=<id>&region=us-east-1&status=OPEN
```

Expect tenant-scoped items only; scoped `nextToken` when another page exists.

### Summary (account-wide)

```http
GET /api/v1/security/ec2/summary?accountId=<id>
```

Aggregates all stored regional summaries for the tenant/account: `openFindingCount`, severity counts, summed `instancesAnalyzed`, simple average of regional scores (regions with `instancesAnalyzed = 0` excluded from score average), newest `analyzedAt`, `scoreAvailability` (`complete` | `partial` | `unavailable`).

### Summary (region-specific)

```http
GET /api/v1/security/ec2/summary?accountId=<id>&region=us-east-1
```

Returns one region’s stored summary and OPEN finding counts for that region only.

## Evidence contract (INSTANCE metadata)

Discovery persists normalized fields including `securityGroups[].inboundRules[]` with `prefixListIds`. **Prefix list contents are not resolved** in this release — SSH/RDP/all-traffic rules that rely only on prefix lists produce `insufficient_security_group_evidence` (not a secure pass). Rerun discovery after future prefix-list resolution work.

Also persisted: `metadataOptions.httpTokens`, `monitoringState`, `iamInstanceProfileArn`, `publicIpAddress`, volume `encrypted`.

## Findings pagination

Tokens encode `{ v, tenantId, scope, key }` (base64url). Malformed, oversized (>2048), or cross-scope tokens → `422 INVALID_REQUEST`.

## Two-region validation

1. Run discovery + security analysis for `us-east-1` and `eu-west-1`.
2. `GET .../summary?accountId=` → `scope: account`, `regionsIncluded` has both, `openFindingCount` equals total OPEN findings (no double-count of instances across regions).
3. `GET .../summary?accountId=&region=us-east-1` → `scope: region`, counts only us-east-1.

## Zero resources

Zero instances: `200` / `SUCCEEDED`, `instancesAnalyzed: 0`, no fabricated findings, orchestrator scores unavailable (`null`), warning in response.

## Audit

`ec2.security_analysis_started`, `_succeeded`, `_partial`, `_failed`, `ec2.security_findings_listed`, `ec2.security_summary_viewed`. No raw ingress or secrets in audit payloads.

## MFA

Analysis start uses tenant RBAC; not a separate MFA-gated mutation in current product policy.

## Rollback

Redeploy previous backend artifact. After re-upgrade, rerun discovery for SG/IMDS evidence.
