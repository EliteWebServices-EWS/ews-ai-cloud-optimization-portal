# Sprint 13 — Security validation report

**Sprint:** Live AWS Account Integration & Evidence Collection Foundation
**Scope:** Cross-account read integration, verification, discovery, tenant bootstrap, MFA, Cognito alignment
**Production evidence:** [sprint-13-production-validation-report.md](../validation/sprint-13-production-validation-report.md)

---

## 1. Threat model summary

| Threat | Mitigation |
|--------|------------|
| Confused deputy (wrong customer role assumption) | External ID in trust policy; registration binds role ARN + account ID |
| Cross-tenant data access | JWT-derived tenant context; membership RBAC on routes |
| Credential theft from platform storage | No long-lived customer keys; STS temporary credentials only |
| Privilege escalation via spoofed headers | Strip untrusted `x-sisum-*`; use authorizer claims only |
| MFA bypass | Privileged middleware; strict `mfa_session_verified` normalization |
| Stale concurrent writes | Optimistic locking on account records |
| Information disclosure | Redacted External ID in API; sanitized errors and audit payloads |

---

## 2. Trust boundaries

```text
Internet → API Gateway (JWT) → Lambda (trusted identity) → DynamoDB (tenant partition)
                                      ↓
                                 STS AssumeRole → Customer account (customer IAM boundary)
```

Customer controls IAM inside their account. Platform controls tenant registry, authentication, and when AssumeRole is attempted.

---

## 3. External ID confused-deputy protection

- Server generates External ID at registration; customer must embed in trust policy.
- STS calls include External ID; mismatch fails AssumeRole.
- External ID must not appear in public documentation or logs; API redacts on read.

---

## 4. Temporary credential handling

- Obtained via `sts:AssumeRole` using platform Lambda execution role.
- Used for verification probes and discovery clients in-process.
- Not written to DynamoDB, audit bodies, or application logs.

---

## 5. Credential caching considerations

- Cache keyed by tenant and role to prevent cross-tenant reuse (see STS adapter tests).
- Expiration checked before reuse; AccessDenied may invalidate and retry once.
- Cache is memory-only within Lambda execution environment (ephemeral).

---

## 6. No credential persistence

Confirmed design and validation goal: no storage of customer access keys, secret keys, or session tokens in persistent stores.

---

## 7. Tenant isolation

- Account records scoped to tenant partition keys.
- Routes resolve tenant from trusted request context, not client-supplied tenant headers alone.

---

## 8. RBAC

- AWS account operations require appropriate tenant membership roles.
- Bootstrap and admin onboarding require platform admin separation.

---

## 9. Platform admin vs tenant-role separation

- `POST /api/v1/admin/tenants` — platform admin.
- `POST /api/v1/tenants/bootstrap-owner` — platform admin + MFA.
- Account register/verify/discovery — tenant roles (e.g. owner/admin).

---

## 10. Privileged MFA

Required for bootstrap and other privileged routes per middleware. Failure closed when MFA evidence missing.

---

## 11. Strict trusted-claim normalization

`mfa_session_verified` accepts only:

- Boolean `true`
- Exact string `"true"`

Denied: `false`, `"false"`, `"TRUE"`, numeric truthy, missing claim, arrays, objects. Addresses API Gateway HTTP API v2 string claim behavior (#189).

---

## 12. Spoofed-header stripping

Browser-supplied `x-sisum-*` identity headers are not trusted; JWT authorizer context drives identity.

---

## 13. Optimistic locking

Verify and discovery updates require consistent `expectedVersion` to prevent lost updates under concurrency.

---

## 14. Audit logging

Sensitive flows emit audit events without credential material or full External ID.

---

## 15. Sanitized errors

Client errors avoid leaking internal ARNs or secrets where possible; operators use CloudWatch for detail.

---

## 16. Customer IAM role trust

Validated pattern:

- Platform: `arn:aws:iam::739275446782:role/SisumLambdaExecutionRole`
- Customer: `arn:aws:iam::572262081497:role/SisumReadOnlyIntegrationRole`
- AssumeRole with External ID condition.

---

## 17. Current broad ReadOnlyAccess validation policy

Production validation used a **broad read-only managed policy** (e.g. AWS managed `ReadOnlyAccess`) to prove integration mechanics quickly.

**This is acceptable for controlled validation only.**

---

## 18. Least-privilege gap

| Control | Status |
|---------|--------|
| Required read API probes | VERIFIED in production |
| Proof that role **denies** write/delete APIs | **NOT VERIFIED** |
| `leastPrivilegeAssurance` field | **NOT_VERIFIED** (expected) |

Successful read probes do **not** prove least privilege.

---

## 19. Recommended production least-privilege migration

Before broad customer rollout:

1. Replace managed `ReadOnlyAccess` with a **custom policy** listing only APIs required for verification, discovery, and near-term optimization reads.
2. Document policy version in customer runbooks.
3. Future sprint: optional IAM policy simulation / analyzer to set `leastPrivilegeAssurance` to VERIFIED when implemented.

---

## 20. Residual risks and mitigations

| Risk | Mitigation |
|------|------------|
| Over-permissioned customer role | Customer policy review; future analyzer |
| Lambda compromise in platform account | Standard AWS account hardening; minimal Lambda IAM |
| Token theft | Short JWT lifetime, HTTPS only, Cognito best practices |
| Operator External ID leakage | Secret handling procedures in runbook |

---

## Security verdict

Sprint 13 **meets** the intended security bar for STS-based, tenant-scoped, read-oriented integration with External ID and MFA hardening, **provided** customers migrate from broad ReadOnlyAccess to narrow policies before general availability.

**Least privilege assurance:** explicitly **not** verified — track as follow-up work.

---

## Related documentation

- [Operations runbook](../operations/sprint-13-live-aws-integration-runbook.md)
- [Architecture](../architecture/sprint-13-live-aws-integration.md)
