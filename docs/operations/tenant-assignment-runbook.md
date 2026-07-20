# Tenant Assignment Runbook

## Overview

Tenant assignment is an **administrator-controlled** operation. End users cannot self-edit `custom:tenantId` through the SPA — the app client `WriteAttributes` list includes only `email`.

## Tenant ID format

Must match backend and Pre Token Generation validation:

- Pattern: `^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,62}[a-z0-9])$`
- Length: 1–64 characters
- Examples: `sisum-default`, `tenant-acme`, `tenant-001`, `a`
- Invalid: uppercase, spaces, slashes, leading/trailing hyphens, empty, >64 chars

Invalid values are **not** injected into access tokens; compatibility mode applies until corrected.

## Assign tenant to existing user

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id <pool-id> \
  --username <username-or-email> \
  --user-attributes \
    Name="custom:tenantId",Value="sisum-default" \
  --region us-east-1
```

## Bulk assignment (CSV-driven)

For each user row (`username`, `tenantId`):

1. Validate tenant ID format against the pattern above
2. Run admin-update-user-attributes
3. Record assignment in change log
4. Ask user to sign out and sign in again (fresh access token)
5. Verify access token contains `tenant_id` (not profile-only assignment)

## New user provisioning

When creating users via admin API, include tenant attribute at creation time:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username <email> \
  --user-attributes \
    Name=email,Value=<email> \
    Name=email_verified,Value=true \
    Name="custom:tenantId",Value="<tenant-id>" \
  --region us-east-1
```

## Security risks of tenant reassignment

Changing a user's `custom:tenantId` immediately changes their data boundary on **next access token issuance** (after sign-in or refresh). Only perform reassignment when:

- Documented in change management
- Old tenant access is no longer required
- Audit trail exists for the reassignment reason

**Do not** reassign tenants to troubleshoot 404 errors without verifying resource ownership.

## Cognito schema and trigger prerequisites

1. User pool must define custom attribute `tenantId` (maps to `custom:tenantId` on profile)
2. Pre Token Generation V2_0 trigger must be attached (inline Lambda in auth stack)
3. Lambda invocation permission must exist **before** trigger attachment (`SourceAccount` scoped)

If stack update cannot add the attribute to an existing pool, follow manual migration steps before assigning values.

## Verification

1. User **signs out and signs in again** (required — existing tokens lack new claims)
2. Decode **access token** — confirm `tenant_id` claim present
3. Confirm `token_use` is `access`
4. Call `GET /api/v1/workflows/status/{id}` for tenant-owned workflow — expect 200
5. Confirm no `tenant.fallback_used` events for this user after fresh login

**Do not** verify tenant identity from the ID token or profile API for API authorization — the backend validates the access token only.

## Strict mode gate

Do **not** enable `TENANT_ENFORCEMENT_MODE=strict` until every production user has:

- Administrator-assigned valid `custom:tenantId` on their profile
- Verified `tenant_id` in a fresh access token after login

## Rollback

Revert user attribute to previous tenant ID using the same admin-update-user-attributes command. User must sign out and sign in again.
