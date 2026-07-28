# Privileged MFA validation runbook (Sprint 12 — corrected)

## Purpose

Document MFA **capability**, **enrollment**, and **current-session verification** separately. Only the last authorizes privileged API operations in the application.

## Three states

1. **MFA_CAPABLE** — Pool allows TOTP (`SOFTWARE_TOKEN_MFA`).
2. **MFA_ENROLLED** — User completed authenticator setup.
3. **MFA_VERIFIED_FOR_CURRENT_SESSION** — Access token carries approved session proof from a trusted source. Accepted claim shape: `"mfa_session_verified": true`, where `true` is the JSON **boolean** value. The string `"true"` is **rejected**.

Steps 1–2 were verified in non-production; step 3 was **not** observed on real access tokens (no `amr` / `cognito:amr`).

## Enrolling TOTP (end user)

1. Sign in with scope including `aws.cognito.signin.user.admin` (required for self-service MFA APIs — not MFA proof).
2. Complete authenticator enrollment in Cognito hosted UI / app flows.

## Checking enrollment (operator)

Use `admin-get-user` in non-production only. Inspect MFA settings — enrollment satisfies **MFA_ENROLLED**, not session verification.

## Privileged API behavior (current)

Create/delete/suspend tenant and privileged role changes return **403** with **`MFA_EVIDENCE_UNAVAILABLE`** unless the access token includes the claim **`mfa_session_verified`** with JSON boolean **`true`** only (not yet issued by Cognito in the current design). String **`"true"`** and other non-boolean values are rejected.

This is intentional fail-closed behavior after real-token validation.

## What does NOT prove session MFA

- `cognito:groups` including `admin`
- `aws.cognito.signin.user.admin` in token scope
- Successful TOTP during login (without a trustworthy token claim)
- `UserMFASettingList` / `PreferredMfaSetting`
- `amr` / `cognito:amr` on observed user-pool access tokens (absent after TOTP)
- Any client header (`x-mfa-verified`, `x-sisum-auth-methods`, etc.)

## Production validation procedure (updated)

1. Confirm pool OPTIONAL TOTP and no SMS MFA for privileged profile.
2. Enroll test admin — record **MFA_ENROLLED: PASS**.
3. Fresh sign-in with TOTP — record challenge **PASS**.
4. Decode access token (secure channel only) — confirm `tenant_id` and groups.
5. Confirm **`amr` absent** — record **MFA_VERIFIED_FOR_CURRENT_SESSION: NOT AVAILABLE**.
6. Call privileged API — expect **403** / **MFA_EVIDENCE_UNAVAILABLE**.

## Next architectural step

Design session assurance (for example Pre Token Generation V2 with authentication-event proof, or custom auth) that sets `mfa_session_verified` only when the **current** sign-in completed MFA. Re-run this runbook before lifting fail-closed.

## Never

Request MFA codes, TOTP secrets, or passwords from users in support channels. Do not log access tokens or Authorization headers.
