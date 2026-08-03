# Sprint 13 release notes

**Release theme:** Live AWS Account Integration & Evidence Collection Foundation
**Mainline merges:** 2026-08-01 — 2026-08-03 (PRs #183–#190)
**Production validation:** [sprint-13-production-validation-report.md](../validation/sprint-13-production-validation-report.md)

---

## User-visible capabilities

- Tenants can register a customer AWS account and receive a unique External ID for IAM trust configuration.
- Tenants can verify that the platform can assume the customer read role and perform required read checks.
- Tenants can run **live account discovery** to collect sanitized metadata (regions, capabilities, warnings).
- Tenant owners can operate after platform onboarding and one-time owner bootstrap (with Cognito reauthentication after tenant creation).

---

## Operator-visible capabilities

- Platform admin tenant creation with Cognito `custom:tenantId` alignment and onboarding retry endpoint.
- One-time **`POST /api/v1/tenants/bootstrap-owner`** for first membership.
- CloudWatch audit trail for account verification and discovery (no credentials in payloads).
- Optimistic locking on AWS account records via `version` / `expectedVersion`.

---

## API additions and changes

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/v1/aws-accounts` | Register account |
| GET | `/api/v1/aws-accounts` | List (paginated) |
| GET | `/api/v1/aws-accounts/:accountId` | Get account |
| POST | `/api/v1/aws-accounts/:accountId/verify` | Requires `expectedVersion` |
| POST | `/api/v1/aws-accounts/:accountId/discovery` | **POST only** (not GET) |
| POST | `/api/v1/tenants/bootstrap-owner` | Platform admin + MFA, one-time |
| POST | `/api/v1/admin/tenants` | Returns `reauthenticationRequired` |
| POST | `/api/v1/admin/tenants/:tenantId/complete-onboarding` | Retry Cognito alignment |

---

## Security fixes

- **#189:** Trusted MFA claim normalization for API Gateway string `"true"`.
- **#188:** Secure one-time tenant owner bootstrap with DynamoDB transaction.
- **#190:** Cognito tenant ID alignment prevents authorization deadlock from claim mismatch.
- Continued stripping of spoofed browser identity headers; privileged MFA not weakened.

---

## Deployment notes

- Deploy via [.github/workflows/deploy-backend.yml](../../.github/workflows/deploy-backend.yml).
- SAM template includes `SisumStsAssumeRolePolicy` and partition-aware Cognito IAM policy.
- Production Lambda name example: `sisum-backend-production`.

---

## Migration notes

- Existing tenants without membership require bootstrap (#188) before tenant-scoped AWS APIs.
- Owners created before #190 may need `complete-onboarding` and reauthentication.
- No DynamoDB schema migration required beyond Sprint 13 account record fields already in code.

---

## Breaking changes

- Discovery endpoint is **POST**; clients using GET must update.
- Verify expects **`expectedVersion`** for safe concurrent updates.

---

## Known limitations

- `leastPrivilegeAssurance` remains **NOT_VERIFIED**.
- Optional IAM alias and Organizations probes may return non-blocking warnings.
- Validation used broad read-only IAM; narrow policy recommended for customers.
- IAM policy inspection for write denial not implemented.

---

## Validation outcome

Live production validation **passed** for registration, verification, and discovery on customer account `572262081497` and tenant `tenant-msddsjji-n270imrc`. See validation report for probe list and warning interpretation.

---

## Rollback summary

1. Redeploy previous Lambda artifact.
2. Customer revokes trust to platform principal to stop AssumeRole immediately.
3. Revert Git merges only if necessary; prefer forward fixes for isolated defects.

---

## Related documentation

- [Closeout](../handoff/sprint-13-closeout.md)
- [Operations runbook](../operations/sprint-13-live-aws-integration-runbook.md)
- [Security validation](../security/sprint-13-security-validation.md)
