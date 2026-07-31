# Cognito MFA session assurance (`mfa_session_verified`)

## Purpose

Connect **fresh** Cognito Managed Login authentication (required TOTP pool) to the application’s trusted access-token claim **`mfa_session_verified`**, while **excluding** refresh-token issuance from privileged assurance.

This is **policy-backed** assurance, not direct proof of a TOTP code inside the Lambda:

- User pool **`MfaConfiguration: 'ON'`** (quoted string) with **`SOFTWARE_TOKEN_MFA`** only.
- Managed Login does not complete fresh authentication until required MFA is satisfied.
- Pre Token Generation V2 runs on Cognito-controlled trigger sources only.
- **`TokenGeneration_HostedAuth`** → add **`mfa_session_verified: true`** (JSON boolean in trigger override).
- **`TokenGeneration_RefreshTokens`** → do **not** add the claim; suppress it if present.
- Post-cutover **global sign-out** revokes pre-change sessions without the claim.

The Lambda does **not** read `clientMetadata`, groups, MFA preference, or `amr` as evidence.

## Production state before deployment (verified)

| Setting | Live / stack |
|--------|----------------|
| `MfaConfiguration` | `OPTIONAL` (live matches stack today) |
| `EnabledMfas` | `SOFTWARE_TOKEN_MFA` |
| Pre Token Generation | V2_0, **`tenant_id` only** |

After a failed stack update (`MfaConfiguration: ON` unquoted → boolean `true`), CloudFormation **rolled back**; live MFA stays **`OPTIONAL`** until **`MfaConfiguration: 'ON'`** is deployed.

## Target state (branch `fix/cognito-totp-mfa-enforcement`)

| Setting | Target |
|--------|--------|
| `MfaConfiguration` | **`'ON'`** (quoted in template) |
| `EnabledMfas` | `SOFTWARE_TOKEN_MFA` |
| Pre Token Generation | V2_0, **`tenant_id`** + conditional **`mfa_session_verified`** |

## Fresh-assurance rule

| Condition | Access token claims |
|-----------|---------------------|
| **`TokenGeneration_HostedAuth`** and **`COGNITO_REQUIRED_MFA=true`** on the Pre Token Lambda | `mfa_session_verified: true` (+ valid `tenant_id` when `custom:tenantId` validates) |
| **`TokenGeneration_HostedAuth`** but **`COGNITO_REQUIRED_MFA`** absent or not `true` | **No** `mfa_session_verified` (fail-closed; `tenant_id` rules unchanged) |
| **`TokenGeneration_RefreshTokens`** | No `mfa_session_verified`; claim suppressed |
| Other / unknown | No `mfa_session_verified`; existing `tenant_id` rules only |

Pool **`MfaConfiguration: ON`** alone is not sufficient inside the Lambda; the server-controlled env var must also be **`true`** (set in `infrastructure/auth/template.yaml` alongside required MFA deployment).

Managed Login OAuth authorization-code flow uses **`TokenGeneration_HostedAuth`** for tokens issued immediately after interactive sign-in (including TOTP).

## Why ClientMetadata cannot be trusted

Clients control `clientMetadata` on auth requests. Accepting MFA proof from metadata would allow spoofing. The inline trigger never reads `event.request.clientMetadata` for assurance.

## Why groups and MFA preference are insufficient

Group membership and “MFA enrolled” describe the **user profile**, not the **current authentication event**. Privileged APIs require evidence tied to **this** access token’s issuance path (hosted auth after pool-required MFA).

## Access token lifetime

SPA app client **`AccessTokenValidity: 60`** minutes (`infrastructure/auth/template.yaml`). After expiry, refresh yields tokens **without** `mfa_session_verified`. Privileged operations then return **`403`** / **`MFA_EVIDENCE_UNAVAILABLE`** until a new interactive Managed Login + TOTP.

Ordinary routes that do not require privileged MFA may continue with refreshed tokens under existing RBAC.

## User experience after refresh

- **Ordinary dashboard/API usage:** May continue if RBAC allows and the session is still valid.
- **Privileged admin/execution actions:** Blocked with **`MFA_EVIDENCE_UNAVAILABLE`**. Frontend maps this to: *“Your secure administrator session has expired. Sign in again to continue.”* User invokes **`beginSecureReauthentication()`** (Cognito logout → login); no automatic redirect loop on API error.

## Cutover sequence

1. Review CloudFormation change set (auth stack **`sisum-auth-production`**, resource **`SisumUserPool`** + inline Lambda code update).
2. Deploy auth stack (not automated in validation tasks).
3. **Globally sign out all users** (revoke refresh tokens / sessions without fresh assurance).
4. Incognito/private browser window.
5. Enroll TOTP if not already enrolled.
6. Complete Managed Login + TOTP.
7. Verify pool MFA config and (locally) JWT claims — do not paste tokens into tickets.
8. Test ordinary API + privileged API.

## Existing-user enrollment

See [cognito-required-totp-mfa-validation.md](./cognito-required-totp-mfa-validation.md). Pool **`ON`** forces setup on next fresh sign-in; IaC does not bind TOTP secrets.

## New-user enrollment

Admin-created users set password, then configure authenticator on first login under **`MfaConfiguration: ON`**.

## Rollback

Revert **`MfaConfiguration`** and Pre Token Generation settings via IaC in **one** deployment:

- If the pool moves from **`ON`** to **`OPTIONAL`** or **`OFF`**, set **`COGNITO_REQUIRED_MFA`** to **`'false'`** or remove it in the same template change.
- **Unsafe:** Leaving **`COGNITO_REQUIRED_MFA: 'true'`** while relaxing pool MFA — the Lambda would **still** issue **`mfa_session_verified`** on **`TokenGeneration_HostedAuth`**, falsely implying required-MFA assurance.

**Security review required** for any rollback that weakens required MFA or session assurance. Do not delete/recreate the user pool.

Consistency is enforced by **`auth-template-mfa-consistency.test.ts`** (structural parse of `infrastructure/auth/template.yaml`).

## Security limitations and residual risks

| Risk | Note |
|------|------|
| Trigger source mismatch | If Cognito emits a different source for Managed Login, assurance must be updated — **stop and report**; do not guess. |
| JWT claim typing | Backend accepts **boolean** `true` only via API Gateway claims. Verify post-deploy that Cognito/API Gateway preserve boolean typing; string `"true"` is **rejected**. |
| Cutover window | Users with old sessions need global sign-out before assuming assurance holds. |
| CloudFormation drift | Drift detection for Cognito MFA is limited; compare live `get-user-pool-mfa-config` to template after deploy. |
| All users require TOTP | `ON` applies to all groups, not only admins. |

## Implementation reference

- Inline Lambda: `infrastructure/auth/template.yaml` → **`SisumPreTokenGenerationFunction`** `ZipFile`
- Backend claim contract: `backend/auth/privileged-mfa.ts`, `backend/lambda.ts`
- Privileged enforcement: `backend/auth/require-privileged-mfa.ts`
- Frontend UX: `frontend/dashboard/src/api/client.ts`

## Verification commands (read-only)

```bash
aws cognito-idp get-user-pool-mfa-config \
  --user-pool-id us-east-1_DARrpLb5p \
  --region us-east-1

aws cognito-idp describe-user-pool \
  --user-pool-id us-east-1_DARrpLb5p \
  --region us-east-1 \
  --query "{MfaConfiguration:MfaConfiguration,AccountRecoverySetting:AccountRecoverySetting}"
```

Offline template check:

```bash
cd backend
COGNITO_VALIDATION_ENABLED=true \
COGNITO_VALIDATION_CONFIRM=I_UNDERSTAND_NON_PRODUCTION \
COGNITO_USER_POOL_ID=us-east-1_DARrpLb5p \
ENVIRONMENT=staging \
npx tsx scripts/validate-cognito-mfa-offline.ts
```
