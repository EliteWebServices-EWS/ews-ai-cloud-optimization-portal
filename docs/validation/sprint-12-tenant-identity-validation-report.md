# Sprint 12 — Tenant & Identity Validation Report

| Field | Value |
| --- | --- |
| Scope | Engineer 4 — identity validation, privileged MFA, integration & security validation |
| Environment | Local / CI + **non-production Cognito TOTP sign-in (manual)** |
| Repository commit | See `git rev-parse HEAD` at validation time |
| Date | 2026-07-28 |

## Non-production Cognito access-token validation (manual)

| Check | Result |
| --- | --- |
| TOTP enrollment | **PASS** |
| TOTP challenge during fresh sign-in | **PASS** |
| TOTP code accepted | **PASS** |
| access token `tenant_id` | **PASS** |
| access token `cognito:groups` | **PASS** |
| access token `amr` | **ABSENT** |
| access token `cognito:amr` | **ABSENT** |
| Reliable current-session MFA evidence on access token | **NOT AVAILABLE** |
| Application privileged MFA production readiness | **CONDITIONAL / BLOCKED** |

Observed access-token shape (representative):

- `token_use`: access
- `scope`: aws.cognito.signin.user.admin openid profile email
- `tenant_id`: sisum-default
- `cognito:groups`: ["admin"]
- `amr`: null
- `cognito:amr`: null

**Statement:** Cognito TOTP enrollment and challenge were verified. Reliable per-request MFA evidence was not present in the issued user-pool access token. Privileged application operations therefore remain fail-closed pending an approved session-assurance design (for example a trusted `mfa_session_verified` claim set only when the current authentication event completed MFA).

Do **not** describe this as “MFA enforcement verified” for privileged APIs in production.

## Test commands

```bash
cd backend
npm ci
npm run test:sprint12
npm test
npm run build
sam validate --lint
sam build --no-cached
```

## Pass / fail summary (local CI)

| Command | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| `npm run test:sprint12` | (see validation run) | | |
| `npm test` | (see validation run) | | |

## Production producer status

| Producer | Location | Trustworthy current-auth event? |
| --- | --- | --- |
| **None in infrastructure** | Pre Token Generation / Cognito templates do not emit `mfa_session_verified` | N/A |
| **Lambda adapter (consumer of JWT only)** | `backend/lambda.ts` | Sets internal header **only** when API Gateway JWT claim is boolean `true` |
| **Integration test fixtures** | `fixtures.ts` sets internal header directly | **No** — policy tests only, not Cognito session assurance |

## MFA policy acceptance status

| Item | Status |
| --- | --- |
| Privileged MFA policy (fail-closed) | **PASS** |
| Cognito `amr` as operational MFA proof | **FAIL / REMOVED** |
| Production privileged operations with real Cognito tokens | **BLOCKED** (`403` / `MFA_EVIDENCE_UNAVAILABLE`) |
| Policy tests with synthetic internal header (simulated post-lambda) | **PASS** — **not** proof of Cognito session assurance |

## Acceptance recommendation

**Conditional:** merge validation artifacts and fail-closed guards; **do not** enable privileged tenant administration in production until session-assurance is designed, implemented, and re-validated with real tokens.
