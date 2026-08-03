# Tenant onboarding runbook

## Problem

Tenant registry IDs are server-generated (`generateTenantId()`). Cognito `custom:tenantId` drives the access-token `tenant_id` claim (via Pre Token Generation). If those diverge, `POST /api/v1/tenants/bootstrap-owner` fails because the JWT tenant does not match the registry.

## Flow (source of truth: generated `tenantId`)

1. Platform Admin with MFA calls `POST /api/v1/admin/tenants`.
2. Tenant is persisted as **PROVISIONING**.
3. Backend sets **`custom:tenantId`** on the owner profile (`ownerUserId` = Cognito **sub**, same as JWT `sub`).
4. On Cognito success → tenant **ACTIVE** + `reauthenticationRequired: true` in the API response.
5. Owner **signs out** and **signs in again** via Hosted UI (new access token required).
6. Owner calls `POST /api/v1/tenants/bootstrap-owner` (MFA + platform admin) to create the first `tenant_owner` membership.

## Failure and retry

If Cognito assignment fails, the tenant stays **PROVISIONING**. Retry:

`POST /api/v1/admin/tenants/:tenantId/complete-onboarding` (Platform Admin + MFA).

Idempotent when the tenant is already **ACTIVE**.

## Do not

- Hand-edit DynamoDB tenant rows or Cognito attributes in normal operations.
- Pass `tenantId` in the create-tenant body (rejected).
- Use an old access token after onboarding (still shows prior `tenant_id`).

## Rollback

- **PROVISIONING** tenant with failed Cognito: fix Cognito/user, retry complete-onboarding, or delete tenant via existing admin lifecycle when appropriate.
- Wrong `custom:tenantId`: re-run complete-onboarding only while **PROVISIONING**, or use controlled Cognito correction + tenant lifecycle per security doc.
