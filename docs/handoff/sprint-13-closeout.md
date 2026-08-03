# Sprint 13 closeout — Live AWS Account Integration & Evidence Collection Foundation

**Status:** COMPLETE (production validated)
**Sprint window (merges to main):** 2026-08-01 through 2026-08-03
**Closeout branch:** `docs/sprint-13-production-closeout` (documentation only)

---

## Business outcome

SISU'M can onboard a real tenant, connect a customer AWS account with industry-standard cross-account trust (External ID + AssumeRole), prove required read access, and collect sanitized discovery evidence for optimization workflows—without storing customer long-lived credentials.

---

## Technical outcome

- Durable AWS account records with generated External ID and verification lifecycle
- STS credential provider with tenant-scoped caching and recovery
- Account management and discovery HTTP APIs with RBAC and audit
- Production fixes: tenant owner bootstrap, MFA JWT claim normalization, Cognito tenant ID alignment
- Production validation on accounts `739275446782` (platform) and `572262081497` (customer), tenant `tenant-msddsjji-n270imrc`

---

## Architecture delivered

End-to-end flows are documented in [sprint-13-live-aws-integration.md](../architecture/sprint-13-live-aws-integration.md) with Mermaid diagrams for onboarding, account onboarding, discovery, and trust boundaries.

Supporting specs:

- [aws-account-discovery.md](../architecture/aws-account-discovery.md)
- [aws-integration-validation-readiness.md](../validation/aws-integration-validation-readiness.md)

---

## Merged PRs and commits

| PR | Merge | Subject |
|----|-------|---------|
| #185 | `80d51ff` | Durable AWS account onboarding foundation |
| #183 | `e52acd5` | STS AssumeRole provider, credential manager, permission validation |
| #184 | `4746ab8` | AWS Account Management APIs |
| #186 | `89bc5c8` | Integration validation readiness report |
| #187 | `3bcd0c0` | Tenant-scoped AWS account discovery |
| #188 | `8ee21ab` | One-time tenant owner bootstrap |
| #189 | `70b61b8` | Trusted MFA JWT claim normalization |
| #190 | `231dfeb` | Tenant onboarding / Cognito identity alignment |

---

## Production deployments

- API: `https://zqe6cl0m15.execute-api.us-east-1.amazonaws.com`
- Lambda: `sisum-backend-production`
- Deploy workflow: [.github/workflows/deploy-backend.yml](../../.github/workflows/deploy-backend.yml)

Validation was performed against deployed production artifacts after merges #187–#190.

---

## Major files / modules

| Area | Paths |
|------|--------|
| Routes | `backend/api/routes/aws-account.routes.ts`, `tenant-bootstrap.routes.ts`, `tenant-admin.routes.ts` |
| Services | `backend/services/aws-account-api-service.ts`, `tenant-owner-bootstrap.ts`, `tenant-onboarding.service.ts` |
| STS / discovery | `backend/execution/adapters/sts/` |
| Persistence | `backend/repositories/dynamodb/dynamodb-aws-account-repository.ts` |
| Auth | `backend/auth/privileged-mfa.ts`, `backend/lambda.ts` |
| Cognito | `backend/cognito/cognito-identity-alignment.ts` |
| IaC | `backend/template.yaml` (`SisumStsAssumeRolePolicy`, Cognito alignment policy) |

---

## APIs delivered

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/admin/tenants` | Create tenant, Cognito alignment, ACTIVE transition |
| POST | `/api/v1/admin/tenants/:tenantId/complete-onboarding` | Retry onboarding |
| POST | `/api/v1/tenants/bootstrap-owner` | One-time first `tenant_owner` (platform admin + MFA) |
| POST | `/api/v1/aws-accounts` | Register account (External ID generated) |
| POST | `/api/v1/aws-accounts/:accountId/verify` | AssumeRole + permission probes |
| POST | `/api/v1/aws-accounts/:accountId/discovery` | Live discovery (POST, not GET) |
| GET | `/api/v1/aws-accounts` | List (paginated) |
| GET | `/api/v1/aws-accounts/:accountId` | Get by ID |

Exact request bodies and status codes: see [sprint-13-live-aws-integration-runbook.md](../operations/sprint-13-live-aws-integration-runbook.md).

---

## DynamoDB persistence behavior

- AWS account items are tenant-scoped with optimistic locking (`version`, `expectedVersion` on updates).
- External ID stored server-side; API responses redact it.
- Verification and discovery write sanitized metadata under account record fields documented in repository layer.
- Bootstrap uses transact write: `OWNER_BOOTSTRAP` marker + first membership.

---

## STS credential flow

Platform Lambda execution role → `sts:AssumeRole` + External ID → customer `SisumReadOnlyIntegrationRole` → short-lived session credentials → in-memory AWS SDK clients → discarded after request. No persistence of secret access key or session token.

---

## Security controls

- External ID confused-deputy protection
- Tenant isolation via JWT-derived context and membership RBAC
- Privileged MFA with strict boolean claim normalization
- Spoofed browser identity headers stripped in Lambda
- Audit events for sensitive operations
- Sanitized error surfaces

Details: [sprint-13-security-validation.md](../security/sprint-13-security-validation.md).

---

## Tests and quality gates

- Unit/integration tests across account, STS, bootstrap, MFA, onboarding, discovery routes
- CI: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- Optional workflow: [.github/workflows/aws-account-onboarding-validation.yml](../../.github/workflows/aws-account-onboarding-validation.yml)
- Closeout gate results: recorded in Sprint 13 completion report (local `npm test`, `npm run build`, `sam validate`, `sam build`)

---

## Production validation result

**PASS** for Sprint 13 scope. See [sprint-13-production-validation-report.md](../validation/sprint-13-production-validation-report.md).

Validated tenant: `tenant-msddsjji-n270imrc`. Do not use `sisum-default` as the production validation tenant in runbooks.

---

## Defects discovered during validation

Documented in [sprint-13-lessons-learned.md](../validation/sprint-13-lessons-learned.md): membership deadlock, MFA string claims, Cognito/registry tenant mismatch, verify `expectedVersion`, token expiry at gateway, optional discovery warnings, least-privilege semantics.

---

## Fixes implemented

#188 bootstrap, #189 MFA normalization, #190 Cognito alignment; discovery POST method; verify version concurrency.

---

## Known limitations

- `leastPrivilegeAssurance` remains NOT_VERIFIED without IAM policy analysis.
- Validation used broad read-only managed policy; narrower custom policy recommended for production customers.
- Optional alias/Organizations probes may warn on minimal accounts.
- IAM policy inspection for write denial not implemented.

---

## Operational ownership

- **Platform ops:** deploy-backend workflow, Lambda/Cognito/DynamoDB tables per `backend/template.yaml`.
- **Customer ops:** IAM trust + read policy, External ID from registration response (handle as secret).
- **Support:** [sprint-13-live-aws-integration-runbook.md](../operations/sprint-13-live-aws-integration-runbook.md)

---

## Rollback guidance

1. Revert Sprint 13 merges on `main` only if catastrophic regression (prefer forward fix).
2. Redeploy previous Lambda artifact via deploy workflow.
3. Customer side: remove or disable trust to `SisumLambdaExecutionRole` to revoke access immediately.
4. DynamoDB account records remain; no automatic customer resource deletion.

---

## Support handoff

- Production validation report and DoD matrix for audit
- Security validation for reviewer sign-off
- Release notes for stakeholder communication
- Evidence helper: `backend/scripts/validate-sprint-13-production-readiness.ts` (optional, env/file based)

---

## Recommended next sprint (proposal — not approved)

**Theme:** Narrow customer IAM guidance + cost/evidence ingestion

- Publish and enforce documented least-privilege IAM policy template (replace broad ReadOnlyAccess validation path)
- Optional IAM policy analyzer for `leastPrivilegeAssurance`
- Wire discovery metadata into evidence engine / first optimization read models
- Scheduled re-verification and discovery refresh
- Operator dashboards for account health and verification drift

---

## Related handoffs

- [Sprint 11 final closure](../handoffs/sprint-11-final-closure.md) (persistence foundation)
