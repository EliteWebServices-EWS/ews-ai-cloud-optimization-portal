# Sprint 12 — Tenant & Identity Security Report

## MFA assurance states (required separation)

| State | Meaning | Proves current-session MFA? |
| --- | --- | --- |
| **MFA_CAPABLE** | User pool supports TOTP (`SOFTWARE_TOKEN_MFA`) | No |
| **MFA_ENROLLED** | User has software token MFA configured | No |
| **MFA_VERIFIED_FOR_CURRENT_SESSION** | Trusted evidence on the access token for this authentication | **Yes — only this state** |

Non-production validation (2026-07-28): TOTP enrollment and challenge **PASS**; access token `amr` / `cognito:amr` **ABSENT**. Therefore A and B were observed; **C was not available** on the user-pool access token.

## Trust boundary (direct HTTP vs Lambda)

Production API traffic:

```text
API Gateway (JWT validated)
  -> backend/lambda.ts attachValidatedIdentityHeaders
  -> Express createApp({ identitySource: 'lambda-adapter' })
  -> routes / MFA policy
```

Direct Express (`npm run dev`, `npm start`, `node dist/index.js`) uses `identitySource: 'direct-http'` by default. It **strips all `x-sisum-*` internal identity headers** (and legacy spoof headers) on every request before authentication context is built. Caller-supplied internal headers are **not** trusted.

AWS Lambda entry uses `Handler: dist/lambda.handler` (see `backend/template.yaml`); **`app.listen` is not used in deployed Lambda**.

| Surface | Production/staging exposure | Identity trust |
| --- | --- | --- |
| Lambda + API Gateway | **Yes** (intended) | JWT via adapter |
| `npm start` / `npm run dev` / direct `app.listen` | Local/dev only unless mis-deployed | **Untrusted** — headers stripped |

`backend/dist/` is gitignored; security review applies to `backend/*.ts` sources only.

### Internal identity headers (catalogue)

| Header | Purpose |
| --- | --- |
| `x-sisum-authenticated` | Adapter-set auth flag |
| `x-sisum-user-id` | Cognito `sub` |
| `x-sisum-user-email` | Email claim |
| `x-sisum-user-groups` | Cognito groups / roles |
| `x-sisum-token-use` | JWT `token_use` |
| `x-sisum-client-id` | App client id |
| `x-sisum-tenant-id` | Trusted `tenant_id` claim |
| `x-sisum-mfa-session-verified` | Trusted `mfa_session_verified === true` |
| `x-sisum-auth-methods` | Reserved / legacy adapter field |
| Any other `x-sisum-*` | Stripped in `direct-http` mode |

Legacy spoof headers also stripped on direct HTTP: `x-tenant-id`, `x-mfa-verified`, `x-auth-method`, `x-amr`.

## MFA enforcement design (corrected)

- Policy: `backend/auth/privileged-mfa.ts`
- Middleware: `backend/auth/require-privileged-mfa.ts`
- **Session evidence:** access-token claim `mfa_session_verified` with JSON **boolean** `true` only (copied to `x-sisum-mfa-session-verified` by `lambda.ts`). String `"true"`, numbers, groups, scope, and enrollment do **not** qualify.
- **Not evidence:** `amr`, `cognito:amr`, `cognito:groups`, admin role, `aws.cognito.signin.user.admin` scope, enrollment, preferred MFA, client headers

## Denial behavior

Privileged operations remain **fail-closed** when session evidence is missing:

- HTTP **403**
- Code **`MFA_EVIDENCE_UNAVAILABLE`**
- Audit: `privileged.mfa_required`, `privileged.mfa_denied`

## Cognito limitation (confirmed in production-style test)

Optional pool MFA and successful TOTP at sign-in **do not** populate `amr` on the observed user-pool access token. The application **must not** claim Cognito access-token `amr` proves MFA.

## Pre Token Generation limitation

Pre Token Generation must **not** set `mfa_verified` or `mfa_session_verified` based only on:

- privileged group membership
- TOTP enrollment
- pool MFA configuration
- preferred MFA setting

Those facts are **MFA_ENROLLED** or **MFA_CAPABLE**, not **MFA_VERIFIED_FOR_CURRENT_SESSION**.

A future claim is acceptable only if tied to proof that **this authentication event** completed MFA (for example Cognito auth event context not yet wired in this sprint).

## OAuth scope note

`aws.cognito.signin.user.admin` remains in the app client and frontend authorize request for **self-service MFA enrollment** — it is **not** evidence that MFA occurred on the current session.

## Unresolved risks

| Risk | Severity |
| --- | --- |
| Privileged tenant APIs blocked for all real Cognito sessions until session assurance exists | Expected (fail-closed) |
| Operators may confuse enrollment with enforcement | Medium — address in runbooks |

## Summary statement

Cognito TOTP enrollment and challenge were verified. Reliable per-request MFA evidence was not present in the issued user-pool access token. Privileged application operations therefore remain fail-closed pending an approved session-assurance design.
