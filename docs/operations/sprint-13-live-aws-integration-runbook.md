# Sprint 13 — Live AWS integration operations runbook

**Audience:** Platform operators, tenant admins, support engineers
**API base (production example):** `https://zqe6cl0m15.execute-api.us-east-1.amazonaws.com`
**Validated tenant (example):** `tenant-msddsjji-n270imrc` — do not treat `sisum-default` as the active production validation tenant.

Placeholders: `<TENANT_ID>`, `<ACCOUNT_ID>`, `<EXTERNAL_ID>`, `<ACCESS_TOKEN>`, `<EXPECTED_VERSION>`.

---

## 1. Onboarding prerequisites

- Platform admin credentials with MFA configured in Cognito.
- Deployed backend with STS AssumeRole IAM on Lambda (`SisumStsAssumeRolePolicy`).
- DynamoDB tables for tenants, memberships, AWS accounts (per `backend/template.yaml`).
- Customer AWS account ID and permission to create IAM roles.

---

## 2. Tenant creation

1. Call **`POST /api/v1/admin/tenants`** as platform admin (privileged MFA as required by route).
2. Record server-generated **`tenantId`** from response.
3. Expect initial registry state **`PROVISIONING`**, then **`ACTIVE`** after Cognito update succeeds.
4. Response includes **`reauthenticationRequired: true`**.

**Success:** HTTP 2xx, tenant object with `ACTIVE` status and stable `tenantId`.

**Retry:** **`POST /api/v1/admin/tenants/:tenantId/complete-onboarding`** if Cognito alignment failed transiently.

---

## 3. Cognito reauthentication requirement

Owner (or bootstrap caller) must **sign out and sign back in** so the access token **`tenant_id`** claim matches the registry `tenantId`. Without this, tenant-scoped routes may fail authorization or target the wrong tenant context.

---

## 4. First-owner bootstrap

1. Authenticate as **platform admin** with valid **MFA session** (`mfa_session_verified` true or `"true"` in JWT).
2. Call **`POST /api/v1/tenants/bootstrap-owner`** (no body; caller bootstrapped as self).
3. **First success:** `tenant_owner` membership `ACTIVE`, version `1`.
4. **Second call:** HTTP **409** (already bootstrapped).

**Recovery — tenant not found / wrong tenant:** Confirm JWT tenant claim after reauthentication; confirm tenant is `ACTIVE`.

---

## 5. Account registration

1. As tenant owner/admin, **`POST /api/v1/aws-accounts`** with `accountId`, `region`, role ARN (per API schema).
2. Store **`externalId`** from response securely (password manager / ticket); **never** paste into public docs or chat.
3. Initial states: `status` **PENDING**, `verificationStatus` **NOT_STARTED**.

API responses **redact** External ID on subsequent reads; retain your secure copy for IAM trust configuration.

---

## 6. Safe handling of External ID

- Treat External ID like a shared secret between customer IAM and platform.
- Configure only in customer role **trust policy** `sts:ExternalId` condition.
- Do not log registration responses in CloudWatch dashboards or tickets unredacted.

---

## 7. Customer IAM trust policy steps

1. Create role `SisumReadOnlyIntegrationRole` (name may vary; ARN must match registration).
2. Trust entity: AWS account **`739275446782`** (platform) or role principal **`arn:aws:iam::739275446782:role/SisumLambdaExecutionRole`** per your standard.
3. Require **`sts:ExternalId`** = `<EXTERNAL_ID>` from registration.
4. Allow **`sts:AssumeRole`** for the platform principal only.

---

## 8. Customer read policy steps

For **validation**, broad read-only managed policies may be used. For **production customers**, use the narrow policy template from security docs (not full `ReadOnlyAccess`).

Minimum APIs exercised by verification:

- `ec2:DescribeInstances`, `ec2:DescribeRegions`
- `autoscaling:DescribeAutoScalingGroups`
- `rds:DescribeDBInstances`
- `s3:ListAllMyBuckets`
- `cloudfront:ListDistributions`
- `lambda:ListFunctions`
- `sts:GetCallerIdentity`

Optional (warnings if unavailable): `iam:ListAccountAliases`, `organizations:DescribeOrganization`.

---

## 9. Verification request

**`POST /api/v1/aws-accounts/:accountId/verify`**

- Include **`expectedVersion`** matching current DynamoDB record version (optimistic lock).
- Success: HTTP **200**, `status` **VERIFIED**, `verificationStatus` **SUCCEEDED**, `lastValidated` set, version incremented.
- Failure: check AssumeRole, External ID mismatch, or version conflict (**409** class behavior per implementation).

---

## 10. Discovery request

**`POST /api/v1/aws-accounts/:accountId/discovery`**

- Not GET.
- Requires verified account and RBAC.
- Success: HTTP **200**, identity matches registered account, metadata persisted, version incremented.

---

## 11. Expected success states

| Stage | status | verificationStatus | Notes |
|-------|--------|-------------------|--------|
| Registered | PENDING | NOT_STARTED | External ID generated |
| Verified | VERIFIED | SUCCEEDED | Probes OK |
| After discovery | VERIFIED | SUCCEEDED | `metadata.discovery` populated |

---

## 12. Retrieve current record version

**`GET /api/v1/aws-accounts/:accountId`** — use `version` field as next `expectedVersion` for verify/update operations.

---

## 13. Optimistic-lock conflict recovery

1. Re-**GET** account record.
2. Retry verify/discovery with new **`expectedVersion`**.
3. If conflicts repeat, check concurrent operators or automation.

---

## 14. Expired-token 401 recovery

Symptom: **401** from API Gateway before Lambda executes.
Cause: JWT expired.
Fix: Refresh session (sign in again); retry with new token.

---

## 15. MFA_EVIDENCE_UNAVAILABLE recovery

Symptom: privileged route denied despite admin role.
Fix: Complete MFA step so JWT includes accepted `mfa_session_verified` (`true` or `"true"` only).
Do not rely on spoofed `x-sisum-*` browser headers.

---

## 16. Tenant-not-found recovery

- Confirm **`custom:tenantId`** in Cognito matches registry.
- Run **`complete-onboarding`** if still PROVISIONING or misaligned.
- Owner reauthentication.

---

## 17. AssumeRole failure troubleshooting

| Symptom | Check |
|---------|--------|
| AccessDenied on AssumeRole | Trust policy principal, External ID exact match, role ARN |
| Invalid client token | Platform Lambda IAM `sts:AssumeRole` resource |
| Wrong account in discovery | Customer registered wrong `accountId` |

CloudWatch: log group for **`sisum-backend-production`**, filter correlation/request ID from API response if available.

---

## 18. Account identity mismatch response

Discovery compares STS caller account to registered ID. Mismatch must **fail** and must **not** promote account to a false VERIFIED state. Fix customer role or registration account ID.

---

## 19. Optional warning interpretation

| Warning | Meaning | Action |
|---------|---------|--------|
| ACCOUNT_ALIAS_UNAVAILABLE | No IAM account alias | None |
| ORGANIZATION_UNAVAILABLE | Not in AWS Organizations | None |

---

## 20. Rollback / revoke customer trust

1. Customer removes platform principal from role trust or deletes role.
2. Platform may mark account suspended/deleted per product procedures (if implemented).
3. Redeploy prior Lambda only for platform-side regressions.

---

## 21. Account suspension / deletion

Follow current API and product policy for tenant admins. Ensure audit trail before deletion. Revoke IAM trust first to stop live access immediately.

---

## 22. Incident escalation checklist

- [ ] Identify tenant ID and account ID (no External ID in ticket subject)
- [ ] Time range and API path (verify vs discovery)
- [ ] HTTP status and request ID
- [ ] CloudWatch Lambda logs (redact tokens)
- [ ] Whether IAM or Cognito changed recently
- [ ] Escalate to security if suspected cross-tenant access

---

## Related documentation

- [Architecture](../architecture/sprint-13-live-aws-integration.md)
- [Security validation](../security/sprint-13-security-validation.md)
- [Production validation report](../validation/sprint-13-production-validation-report.md)
