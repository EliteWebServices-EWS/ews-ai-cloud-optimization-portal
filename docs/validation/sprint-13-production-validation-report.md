# Sprint 13 production validation report

**Sprint title:** Live AWS Account Integration & Evidence Collection Foundation
**Branch (closeout):** `docs/sprint-13-production-closeout`
**Baseline on main:** through merge `231dfeb` (2026-08-03)
**Validation type:** Live AWS production API against real customer test account

---

## 1. Executive summary

Sprint 13 successfully connected the SISU'M production backend to a real customer AWS account using STS AssumeRole with External ID, completed tenant onboarding and first-owner bootstrap, verified required read permissions, and executed live account discovery with sanitized metadata persistence. Production validation used platform account **739275446782** and customer account **572262081497** via API `https://zqe6cl0m15.execute-api.us-east-1.amazonaws.com` (Lambda `sisum-backend-production`).

All required read probes and discovery checks **VERIFIED**. Optional alias and Organizations probes produced **expected warnings**. **Least privilege assurance remains NOT_VERIFIED** by design until IAM policy inspection exists. No long-lived customer credentials were stored; External ID and tokens were handled per security policy and are **not** reproduced in this document.

**Production-readiness verdict:** **GO** for the Sprint 13 scope (live read-only integration, verification, discovery, tenant-scoped RBAC) with documented limitations on least-privilege proof and recommended migration from broad `ReadOnlyAccess` to a narrower customer policy before broad rollout.

---

## 2. Sprint goal

Transform SISU'M from mock or simulated cloud access into a platform that:

- Securely connects to customer AWS accounts via STS AssumeRole
- Validates required read permissions
- Performs tenant-scoped live account discovery
- Persists sanitized discovery evidence

---

## 3. Scope validated

| Area | Status |
|------|--------|
| Durable AWS account registration & External ID generation | VERIFIED |
| STS AssumeRole & temporary credentials | VERIFIED |
| Permission verification (required probes) | VERIFIED |
| Live discovery (`POST /api/v1/aws-accounts/:accountId/discovery`) | VERIFIED |
| Discovery metadata persistence & optimistic locking | VERIFIED |
| Tenant onboarding & Cognito `custom:tenantId` alignment | VERIFIED |
| One-time tenant owner bootstrap | VERIFIED |
| Privileged MFA & trusted claim normalization | VERIFIED |
| Tenant isolation & membership RBAC on account routes | VERIFIED |
| Least privilege assurance via policy inspection | NOT VERIFIED (expected) |
| Full custom least-privilege IAM policy rollout | OUT OF SCOPE (Sprint 13 used validation-oriented read policy) |

---

## 4. Environment and accounts

| Item | Value |
|------|--------|
| Production API base | `https://zqe6cl0m15.execute-api.us-east-1.amazonaws.com` |
| Production Lambda | `sisum-backend-production` |
| Platform AWS account | `739275446782` |
| Customer / test AWS account | `572262081497` |
| Customer integration role | `arn:aws:iam::572262081497:role/SisumReadOnlyIntegrationRole` |
| Platform trusted principal | `arn:aws:iam::739275446782:role/SisumLambdaExecutionRole` |
| Validated tenant ID | `tenant-msddsjji-n270imrc` |
| Validated region | `us-east-1` |

---

## 5. Preconditions

- Platform admin created and activated tenant via admin onboarding APIs.
- Owner completed Cognito reauthentication so JWT `tenant_id` matches registry tenant ID.
- Platform admin with privileged MFA bootstrapped first `tenant_owner` membership.
- Tenant owner registered AWS account `572262081497`; External ID generated server-side and configured in customer trust policy (value redacted in all docs).
- Customer IAM role trust allowed platform principal with External ID condition.
- Valid, non-expired access token and MFA session evidence for privileged routes.

---

## 6. Tenant onboarding validation

| Check | Result |
|-------|--------|
| `POST /api/v1/admin/tenants` creates tenant with server-generated `tenantId` | VERIFIED |
| Initial registry status `PROVISIONING` | VERIFIED |
| Cognito `custom:tenantId` updated for owner | VERIFIED |
| Transition to `ACTIVE` after Cognito success | VERIFIED |
| Response includes `reauthenticationRequired: true` | VERIFIED |
| Post sign-in token tenant claim matches registry ID | VERIFIED |
| Retry via `POST /api/v1/admin/tenants/:tenantId/complete-onboarding` available | VERIFIED (capability on main) |

---

## 7. Tenant owner bootstrap validation

| Check | Result |
|-------|--------|
| `POST /api/v1/tenants/bootstrap-owner` (platform admin + MFA) | VERIFIED |
| Caller bootstraps self; identities server-derived | VERIFIED |
| First call creates `tenant_owner` membership (`ACTIVE`, version 1) | VERIFIED |
| Second call returns HTTP 409 | VERIFIED (behavior on main) |
| TransactWrite with `OWNER_BOOTSTRAP` marker | VERIFIED (implementation; production exercised once) |

---

## 8. AWS account registration validation

| Field / behavior | Result |
|------------------|--------|
| `accountId` `572262081497` | VERIFIED |
| `region` `us-east-1` | VERIFIED |
| Initial `status` / `verificationStatus` | PENDING / NOT_STARTED — VERIFIED |
| External ID generated and persisted (not in docs) | VERIFIED |
| API redacts External ID in responses | VERIFIED (design) |

---

## 9. Customer IAM role and trust-policy validation

| Check | Result |
|-------|--------|
| Trust policy allows `sts:AssumeRole` from `SisumLambdaExecutionRole` | VERIFIED |
| External ID condition present on trust | VERIFIED |
| No platform storage of customer access keys | VERIFIED |

---

## 10. STS AssumeRole verification

| Check | Result |
|-------|--------|
| AssumeRole succeeds for registered role ARN | VERIFIED |
| Session principal form | `arn:aws:sts::572262081497:assumed-role/SisumReadOnlyIntegrationRole/<session-name>` — VERIFIED |
| Credentials used only in-memory for request scope | VERIFIED (design) |

---

## 11. Required permission validation

Verification returned HTTP **200**, `status: VERIFIED`, `verificationStatus: SUCCEEDED`, record **version 3**, `lastValidated` populated.

| Probe | Result |
|-------|--------|
| `ec2:DescribeInstances` | VERIFIED |
| `autoscaling:DescribeAutoScalingGroups` | VERIFIED |
| `rds:DescribeDBInstances` | VERIFIED |
| `s3:ListAllMyBuckets` | VERIFIED |
| `cloudfront:ListDistributions` | VERIFIED |
| `lambda:ListFunctions` | VERIFIED |

---

## 12. Live AWS discovery validation

Discovery invoked with **`POST /api/v1/aws-accounts/:accountId/discovery`** (not GET).

| Check | Result |
|-------|--------|
| HTTP 200 | VERIFIED |
| GetCallerIdentity account matches `572262081497` | VERIFIED |
| Assumed-role principal confirmed | VERIFIED |
| Enabled regions discovered | VERIFIED |
| `sts:GetCallerIdentity` capability | VERIFIED |
| `ec2:DescribeRegions` capability | VERIFIED |
| Required read capabilities summary | VERIFIED |
| Optional `iam:ListAccountAliases` | PASSED WITH EXPECTED WARNING |
| Optional `organizations:DescribeOrganization` | PASSED WITH EXPECTED WARNING |
| Record **version 4** after discovery | VERIFIED |

---

## 13. Persistence validation

| Check | Result |
|-------|--------|
| Discovery metadata on AWS account record | VERIFIED |
| Sanitized fields only (no raw credentials) | VERIFIED (design) |
| Optimistic locking via `expectedVersion` on verify | VERIFIED (required in production flow) |

---

## 14. Tenant isolation and RBAC validation

| Check | Result |
|-------|--------|
| Tenant ID from trusted JWT / authorizer context | VERIFIED (design) |
| Account routes scoped to tenant membership | VERIFIED |
| Cross-tenant access denied | VERIFIED (test suite + production path) |

---

## 15. MFA validation

| Check | Result |
|-------|--------|
| Privileged routes require MFA evidence | VERIFIED |
| `mfa_session_verified` accepts boolean `true` and string `"true"` only | VERIFIED |
| `"false"`, `"TRUE"`, missing, spoofed `x-sisum-*` headers denied | VERIFIED |

---

## 16. Audit validation

| Check | Result |
|-------|--------|
| Account verify / discovery emit audit events | VERIFIED (implementation) |
| Audit payloads exclude secrets | VERIFIED (design) |

---

## 17. Error-path validation

| Scenario | Result |
|----------|--------|
| Expired JWT → API Gateway 401 before Lambda | VERIFIED (observed in validation) |
| Identity mismatch on discovery must not mark account VERIFIED incorrectly | VERIFIED (design + tests) |
| Bootstrap second call 409 | VERIFIED |
| MFA evidence unavailable → denied | VERIFIED (design) |

---

## 18. Observed warnings (non-blocking)

| Warning | Reason | Classification |
|---------|--------|----------------|
| `ACCOUNT_ALIAS_UNAVAILABLE` | No account alias configured in test account | PASSED WITH EXPECTED WARNING |
| `ORGANIZATION_UNAVAILABLE` | Test account not in AWS Organizations | PASSED WITH EXPECTED WARNING |

---

## 19. Least privilege interpretation

| Item | Status |
|------|--------|
| `leastPrivilegeAssurance` after discovery | **NOT_VERIFIED** |
| Reason | Successful read probes prove required APIs work; they do **not** prove absence of write/delete permissions |
| Sprint 13 expectation | Documented and correct — **not** a discovery failure |

Do **not** treat read-probe success as least-privilege verification.

---

## 20. Evidence table

| Evidence type | Location / note |
|---------------|-----------------|
| Merged implementation | main: `80d51ff` #185, `e52acd5` #183, `4746ab8` #184, `89bc5c8` #186, `3bcd0c0` #187, `8ee21ab` #188, `70b61b8` #189, `231dfeb` #190 |
| Architecture | [sprint-13-live-aws-integration.md](../architecture/sprint-13-live-aws-integration.md) |
| Security | [sprint-13-security-validation.md](../security/sprint-13-security-validation.md) |
| Operations | [sprint-13-live-aws-integration-runbook.md](../operations/sprint-13-live-aws-integration-runbook.md) |
| Lessons | [sprint-13-lessons-learned.md](./sprint-13-lessons-learned.md) |
| DoD matrix | [sprint-13-definition-of-done.md](./sprint-13-definition-of-done.md) |
| Prior readiness | [aws-integration-validation-readiness.md](./aws-integration-validation-readiness.md) |
| Live production exercise | Operator-captured HTTP responses (redacted); tenant `tenant-msddsjji-n270imrc` |

---

## 21. Definition of Done mapping

See [sprint-13-definition-of-done.md](./sprint-13-definition-of-done.md) for requirement-level status. Summary: Sprint 13 DoD items for live integration, discovery, docs, and rollback guidance are **COMPLETE** or **COMPLETE WITH LIMITATION** (least privilege, optional bench workflows).

---

## 22. Residual risks

- Customer role may attach broader managed policies (e.g. `ReadOnlyAccess`) until narrowed.
- Least privilege not machine-verified.
- Operator dependency on correct External ID and trust policy sync.
- Token expiry during long operator sessions (401 at gateway).

---

## 23. Final production-readiness verdict

| Dimension | Verdict |
|-----------|---------|
| Live read integration (Sprint 13 scope) | **Approved** |
| Security controls (STS, External ID, no credential persistence, RBAC, MFA) | **Approved with documented gaps** |
| Least-privilege proof | **Not approved as VERIFIED** — track as follow-up |
| Broad customer rollout | **Conditional** — migrate to narrower IAM policy per security report |

---

## Related documentation

- [Sprint 13 closeout](../handoff/sprint-13-closeout.md)
- [Release notes](../releases/sprint-13-release-notes.md)
- [AWS account discovery architecture](../architecture/aws-account-discovery.md)
