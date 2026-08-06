# EC2 Security & Governance Analysis

Read-only analysis over **durable EC2 discovery inventory** in `CLOUD_RESOURCES_TABLE_NAME`. The analyzer engine (`backend/engines/ec2-security`) is unchanged; orchestration loads INSTANCE/VOLUME rows, maps metadata to analyzer input, persists findings/runs/summaries, and exposes tenant-scoped APIs.

## APIs

- `POST /api/v1/analysis/ec2/security` — `{ accountId, regions?, policy? }` only; verified account required.
- `GET /api/v1/recommendations/ec2/security` — tenant-scoped findings with scoped pagination.
- `GET /api/v1/security/ec2/summary` — latest summary per account/region.

## Evidence (INSTANCE metadata)

Normalized persisted fields: `securityGroups[]` (batched `DescribeSecurityGroups` once per region), `metadataOptions`, `monitoringState`, `iamInstanceProfileArn`, `publicIpAddress`, plus attached volume encryption.

**Prefix lists:** `prefixListIds` are stored but not resolved via AWS APIs. Rules covering SSH (22), RDP (3389), or all traffic that use prefix lists without CIDRs are treated as **insufficient evidence** — never as confirmed secure.

Missing ingress/IMDS evidence triggers supplemental `insufficient_*_evidence` findings.

## Summary API

- `GET /api/v1/security/ec2/summary?accountId=` — account-wide aggregation across stored regional summaries (simple average of scores for regions with analyzed instances; null/unavailable when none).
- `GET /api/v1/security/ec2/summary?accountId=&region=` — single-region view.

`openFindingCount` at account scope sums OPEN findings across regions (via live findings query, not primary-region-only).

## Lifecycle

Finding key: tenant, account, region, resourceId, check, rule version `1`. Recurring detections preserve `firstDetectedAt`, bump `version`, respect ACKNOWLEDGED/DISMISSED, reopen RESOLVED when detected again. OPEN findings absent after a **SUCCEEDED** run in analyzed regions are resolved; PARTIAL/FAILED runs do not resolve.

## RBAC

Start: `tenant_owner`, `tenant_admin`, `security_admin`, `analyst`. Read: includes `viewer`, `auditor`. Demo dashboard remains on curated data; live dashboard uses these APIs only.
