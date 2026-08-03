# Tenant onboarding validation

## Tests

- `backend/tests/unit/cognito-identity-alignment.test.ts`
- `backend/tests/unit/tenant-onboarding.service.test.ts`
- `backend/tests/unit/template-cognito-iam.test.ts`
- `backend/tests/integration/tenant-onboarding-http.test.ts`
- Updated tenant administration CRUD / HTTP tests

## Quality gates

```bash
cd backend
npm ci
npm test
npm run build
sam validate --lint
sam build --no-cached
cd ..
git diff --check
```

## Manual production checklist

1. Platform Admin + MFA: `POST /api/v1/admin/tenants` → **201**, `tenant.status=ACTIVE`, `reauthenticationRequired=true`.
2. Verify Cognito user `custom:tenantId` equals response `tenant.tenantId`.
3. Owner sign-out / sign-in; decode access token → `tenant_id` matches.
4. `POST /api/v1/tenants/bootstrap-owner` → **201**.
5. CloudWatch: `tenant.onboarding_*` / `tenant.identity_assignment_*` without token material.

## API contract

**POST /api/v1/admin/tenants** — unchanged path; response:

```json
{
  "data": {
    "tenant": { "...": "TenantRecord ACTIVE" },
    "reauthenticationRequired": true
  }
}
```

**POST /api/v1/admin/tenants/:tenantId/complete-onboarding** — retry/idempotent completion.

## Known limitations

- No automatic rollback of PROVISIONING tenant on Cognito failure (retry intended).
- Email-alias pools: `ownerUserId` must remain the Cognito username/sub accepted by AdminUpdateUserAttributes.
