# Phase 1 Tenant Isolation — Engineering Handoff

**Sprint:** 10.5.16  
**Branch:** `feature/tenant-isolation-foundation`  
**Status:** Ready for review (not deployed)

## Architecture correction (security review)

The initial implementation incorrectly assumed Cognito places `custom:tenantId` in **access tokens**. AWS does not — custom user-pool attributes appear on the user profile and (optionally) ID tokens, not access tokens.

**Correct architecture:**

| Layer | Source |
|-------|--------|
| User profile | `custom:tenantId` (admin-assigned) |
| Access token | `tenant_id` (injected by Pre Token Generation V2_0 Lambda) |
| Backend | Reads `tenant_id` from API Gateway-validated access token only |

Until the Pre Token Generation trigger is deployed, compatibility mode uses `DEFAULT_TENANT_ID` for all users — real per-user tenant isolation is **not** active in production.

## Key files

| Area | Files |
|------|-------|
| Identity | `backend/auth/tenant.ts`, `tenant-validator.ts`, `request-security-context.ts`, `require-tenant.ts`, `tenant-guard.ts` |
| Lambda | `backend/lambda.ts` (claim extraction, header stripping) |
| Stores | `workflow.store.ts`, `report.store.ts`, `learning.store.ts` |
| API | `backend/api/routes/index.ts`, `tenant-route-helpers.ts` |
| Infra | `infrastructure/auth/template.yaml` (inline Pre Token Gen ZipFile), `backend/template.yaml`, `infrastructure/monitoring/template.yaml` |
| Tests | `tenant.test.ts`, `tenant-isolation.test.ts`, `pre-token-generation.test.ts` |
| Docs | `docs/security/10.5.16-tenant-isolation-foundation.md` |

## Deployment order

1. Deploy auth stack in dependency order: Lambda role → function → **SourceAccount permission** → user pool trigger (V2_0)
2. Assign `custom:tenantId=sisum-default` to all existing users (administrator only)
3. Require fresh login; verify `tenant_id` in access tokens
4. Deploy backend Lambda (`TENANT_ENFORCEMENT_MODE=compatibility`)
5. Deploy monitoring stack (tenant denial alarm)
6. Keep strict mode disabled until token verification complete

## Validation completed locally

- TypeScript build: pass
- Tests: 119/119 pass
- SAM validate --lint: pass
- SAM build: pass
- Auth CFN template: valid
- Monitoring CFN template: valid

## Not included

- DynamoDB workflow/report persistence
- Real AWS provider integration
- Frontend changes (none required)
- Per-tenant billing or branding

## Next sprint candidates

- DynamoDB tenant-partitioned workflow/report tables
- Strict mode production cutover checklist automation
- Platform admin cross-tenant audit (if product requires)

## Reviewers should verify

- No client tenant trust paths
- Cross-tenant tests cover workflow, report, learning, execution
- Compatibility mode audit events emit correctly
- Cognito template change safe for existing pool
