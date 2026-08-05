# Sprint 13 — Lessons learned

Production validation for Live AWS Account Integration surfaced integration and identity issues that were fixed before closeout. This document captures symptoms, root causes, fixes, prevention, and reusable principles.

---

## 1. No initial tenant membership caused authorization deadlock

| | |
|---|---|
| **Symptom** | Tenant existed but AWS account APIs returned forbidden / no effective tenant role. |
| **Root cause** | Registry tenant without durable `tenant_owner` membership row. |
| **Fix** | #188 — `POST /api/v1/tenants/bootstrap-owner` with transact-protected first membership. |
| **Prevention** | Document bootstrap in runbooks; gate tenant AWS workflows on membership checks in ops checklists. |
| **Principle** | **Authorization requires durable membership facts, not only tenant registry rows.** |

---

## 2. One-time tenant-owner bootstrap was required

| | |
|---|---|
| **Symptom** | No path for first owner without manual DynamoDB intervention. |
| **Root cause** | Chicken-and-egg: tenant-scoped RBAC needed a member before self-service role assignment existed. |
| **Fix** | Platform-admin-only bootstrap endpoint with 409 on duplicate. |
| **Prevention** | Onboarding checklist: create tenant → Cognito realign → reauth → bootstrap owner. |
| **Principle** | **Explicit bootstrap beats ad hoc data fixes in production.** |

---

## 3. API Gateway string representation of `mfa_session_verified` caused false MFA denial

| | |
|---|---|
| **Symptom** | Privileged routes denied immediately after successful MFA. |
| **Root cause** | Claim parser accepted only boolean `true`; API Gateway often delivers `"true"` string. |
| **Fix** | #189 — `normalizeTrustedBooleanClaim` accepts `true` and `"true"` only. |
| **Prevention** | Unit tests for string/boolean claim matrix; integration tests through HTTP layer. |
| **Principle** | **Normalize authorizer claims at the trust boundary; never assume JSON types survive API Gateway.** |

---

## 4. Tenant registry ID and Cognito tenant claim were misaligned

| | |
|---|---|
| **Symptom** | JWT tenant did not match registry; tenant-scoped queries failed or targeted wrong partition. |
| **Root cause** | Tenant created in registry without updating Cognito `custom:tenantId`. |
| **Fix** | #190 — onboarding service sets Cognito attribute before ACTIVE; `reauthenticationRequired`. |
| **Prevention** | Automated onboarding orchestration; retry endpoint; verify claim after sign-in. |
| **Principle** | **Identity stores must be updated in the same workflow as registry state transitions.** |

---

## 5. Tenant onboarding required explicit Cognito synchronization and reauthentication

| | |
|---|---|
| **Symptom** | Operators saw ACTIVE tenant but tokens still carried old/missing tenant claim. |
| **Root cause** | Cognito attributes not refreshed in existing sessions after admin create. |
| **Fix** | Document mandatory sign-out/sign-in; `reauthenticationRequired: true` in API response. |
| **Prevention** | UI/operator messaging; complete-onboarding retry. |
| **Principle** | **Session artifacts lag backend fixes — plan for forced reauth when claims change.** |

---

## 6. Verify endpoint required `expectedVersion`

| | |
|---|---|
| **Symptom** | Verify failed or conflicted when record changed between read and write. |
| **Root cause** | Optimistic locking required but operators omitted version from first attempts. |
| **Fix** | Operational pattern: GET account → verify with current `version`. |
| **Prevention** | Runbook steps; client SDKs should read-modify-write. |
| **Principle** | **Expose concurrency explicitly instead of silent last-write-wins on security-sensitive records.** |

---

## 7. Expired token caused API Gateway 401 before Lambda

| | |
|---|---|
| **Symptom** | 401 with no Lambda log entry for the route. |
| **Root cause** | JWT expired at authorizer. |
| **Fix** | Refresh session; retry (not a product defect). |
| **Prevention** | Long-running operator playbooks include token refresh; short step timeouts. |
| **Principle** | **Distinguish edge 401 (authorizer) from application 401/403 in triage.** |

---

## 8. Account alias and Organizations warnings were expected optional outcomes

| | |
|---|---|
| **Symptom** | Discovery success with warnings `ACCOUNT_ALIAS_UNAVAILABLE`, `ORGANIZATION_UNAVAILABLE`. |
| **Root cause** | Optional probes on minimal test account without alias or Org membership. |
| **Fix** | Document as PASSED WITH EXPECTED WARNING; no code change required. |
| **Prevention** | Test plan distinguishes required vs optional probes. |
| **Principle** | **Tier validation requirements: blocking vs informational.** |

---

## 9. Successful read probes did not prove least privilege

| | |
|---|---|
| **Symptom** | Stakeholders asked whether role was “least privilege verified.” |
| **Root cause** | Read success does not imply absence of write permissions on attached policies. |
| **Fix** | Keep `leastPrivilegeAssurance` NOT_VERIFIED; security report and validation report state clearly. |
| **Prevention** | Do not conflate verification SUCCEEDED with least-privilege proof in docs or UI copy. |
| **Principle** | **Name security claims precisely; prove negatives with policy analysis, not positive read tests.** |

---

## Related documentation

- [Production validation report](./sprint-13-production-validation-report.md)
- [Definition of Done](./sprint-13-definition-of-done.md)
- [Closeout](../handoff/sprint-13-closeout.md)
