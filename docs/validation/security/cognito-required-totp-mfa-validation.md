# Cognito required TOTP MFA — validation report

## Root cause

The production user pool `us-east-1_DARrpLb5p` (name `sisum-production-users`, managed by the auth CloudFormation stack) had **no effective MFA configuration** in AWS:

- `get-user-pool-mfa-config` returned `MfaConfiguration: null` and `SoftwareTokenMfaConfiguration: null`.
- Confirmed users showed **MFA inactive** with no methods enrolled.
- Console attempts to toggle “MFA active” without pool-level software-token MFA and without user TOTP enrollment fail with `InvalidParameterException`.

Repository IaC (`infrastructure/auth/template.yaml`, resource **`SisumUserPool`**) already declared `EnabledMfas: [SOFTWARE_TOKEN_MFA]` and `AccountRecoverySetting`, but **`MfaConfiguration` was `OPTIONAL`**, and the live pool had **drifted** (MFA not applied). TOTP cannot be enforced or enrolled correctly until the pool enables software-token MFA and MFA is **required** (`ON`).

## Prior deployed state (observed)

| Setting | Live pool | IaC before this change |
|--------|-----------|-------------------------|
| `MfaConfiguration` | `null` | `OPTIONAL` |
| `SoftwareTokenMfaConfiguration` | `null` | Implied by `EnabledMfas` (not applied live) |
| `AccountRecoverySetting` | `null` | `verified_email` priority 1 |
| User MFA | Inactive, no methods | N/A |

## Required configuration

On **`AWS::Cognito::UserPool` → `SisumUserPool`**:

```yaml
MfaConfiguration: ON
EnabledMfas:
  - SOFTWARE_TOKEN_MFA
AccountRecoverySetting:
  RecoveryMechanisms:
    - Name: verified_email
      Priority: 1
```

- **SMS MFA:** not enabled (not in `EnabledMfas`).
- **Email MFA:** not enabled (no `EMAIL_OTP` / email MFA factor).
- **No second user pool.** Same `UserPoolName`, schema, triggers, domain, clients, groups.

## Files changed

| File | Change |
|------|--------|
| `infrastructure/auth/template.yaml` | `MfaConfiguration: OPTIONAL` → **`ON`** (comment on enrollment behavior) |
| `backend/tests/unit/pre-token-generation.test.ts` | Static assertions for MFA, recovery, tenant schema, callbacks |
| `backend/tests/unit/identity.test.ts` | Expect **`ON`** instead of `OPTIONAL` |
| `backend/scripts/validate-cognito-mfa-offline.ts` | Offline check expects **`ON`** |
| `docs/validation/security/cognito-required-totp-mfa-validation.md` | This document |

## Stack ownership (do not deploy blindly)

The pool ID **`us-east-1_DARrpLb5p`** is the default in `backend/template.yaml` (`CognitoUserPoolId` parameter) and matches operational docs (`sisum-production-users`, domain prefix `sisum-production-739275446782`).

**Before deploy**, confirm the auth stack still owns that pool:

```bash
aws cloudformation describe-stacks \
  --stack-name sisum-auth-production \
  --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text
```

Expected: `us-east-1_DARrpLb5p`. If the stack name differs, locate the stack whose `UserPoolId` output matches this ID. **Stop and report** if no stack manages this pool.

Logical resource: **`SisumUserPool`** in `infrastructure/auth/template.yaml`.

## Deployment precautions

1. **Preview only** — create a change set; do not execute without review:

   ```bash
   aws cloudformation create-change-set \
     --stack-name sisum-auth-production \
     --change-set-name cognito-required-totp-mfa \
     --template-body file://infrastructure/auth/template.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --region us-east-1
   ```

   Or deploy with SAM/CLI equivalent used for this stack historically.

2. **Confirm in the change set:**
   - `AWS::Cognito::UserPool` → **Modify** (not Replace).
   - No replacement for `SisumUserPoolClient`, `SisumUserPoolDomain`, or groups.
   - Users and group memberships **retained** (`DeletionPolicy: Retain` / `UpdateReplacePolicy: Retain` on the pool).

3. **Do not** run `admin-set-user-mfa-preference` as a substitute for authenticator enrollment.

4. **Do not** store or generate TOTP secrets in the repository.

## Deployment command (review only — not executed in this task)

From repository root (adjust stack name/parameters to match your environment):

```bash
aws cloudformation deploy \
  --template-file infrastructure/auth/template.yaml \
  --stack-name sisum-auth-production \
  --parameter-overrides Environment=production ApplicationName=sisum CognitoDomainPrefix=sisum-production-739275446782 PrimaryDomainName=elitewebservices.org \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --no-execute-changeset
```

Remove `--no-execute-changeset` only after human approval of the change set.

## Existing-user enrollment procedure

CloudFormation sets **pool-level required MFA**; it does **not** bind a TOTP device for existing users.

1. **Global sign-out** affected users (or entire pool if coordinated maintenance):

   ```bash
   aws cognito-idp admin-user-global-sign-out \
     --user-pool-id us-east-1_DARrpLb5p \
     --username <username-or-sub> \
     --region us-east-1
   ```

2. User opens **managed login** in a **private/incognito** window (avoids stale sessions).
3. Sign in with password → Cognito presents **MFA setup** (associate software token).
4. Scan QR / enter secret in authenticator app → submit valid 6-digit TOTP.
5. Complete sign-in; user should show `PreferredMfaSetting: SOFTWARE_TOKEN_MFA`.

Console “MFA active” without these steps will continue to fail until enrollment completes.

## New-user behavior

Admin-created users (`AllowAdminCreateUserOnly: true`) must set a permanent password on first login, then **configure TOTP** before authentication succeeds under `MfaConfiguration: ON`.

## Cognito MFA vs application privileged MFA

| Layer | Purpose |
|-------|---------|
| **Cognito TOTP (`MfaConfiguration: ON`)** | Proves the user completed MFA during **Cognito authentication** (sign-in / token issuance). |
| **`mfa_session_verified` (access token)** | Application **trusted evidence** for privileged API routes (`require-privileged-mfa`, `privileged-mfa.ts`). Copied from JWT by API Gateway / `lambda.ts`; **not** set by clients. |

**Session assurance (same branch):** `SisumPreTokenGenerationFunction` now sets **`mfa_session_verified: true`** only for **`TokenGeneration_HostedAuth`**, not for refresh. See [cognito-mfa-session-assurance.md](./cognito-mfa-session-assurance.md). Until the auth stack is deployed and users complete a fresh Managed Login after global sign-out, privileged APIs may still return **`MFA_EVIDENCE_UNAVAILABLE`**.

**Do not** weaken `require-privileged-mfa`, header stripping, or fail-closed behavior. **Do not** treat Cognito enrollment alone as privileged API authorization without the access-token claim on the **current** token.

## Post-deployment verification (read-only)

Pool MFA:

```bash
aws cognito-idp get-user-pool-mfa-config \
  --user-pool-id us-east-1_DARrpLb5p \
  --region us-east-1
```

Expected:

```json
{
  "SoftwareTokenMfaConfiguration": {
    "Enabled": true
  },
  "MfaConfiguration": "ON"
}
```

Pool summary:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id us-east-1_DARrpLb5p \
  --region us-east-1 \
  --query "{MfaConfiguration:MfaConfiguration,AccountRecoverySetting:AccountRecoverySetting}"
```

Example admin user after successful enrollment:

```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-1_DARrpLb5p \
  --username c478b478-a041-707a-6ed0-2adee06a2c92 \
  --region us-east-1 \
  --query "{Username:Username,Enabled:Enabled,Status:UserStatus,PreferredMfaSetting:PreferredMfaSetting,UserMFASettingList:UserMFASettingList}"
```

Expected after enrollment:

```json
{
  "PreferredMfaSetting": "SOFTWARE_TOKEN_MFA",
  "UserMFASettingList": ["SOFTWARE_TOKEN_MFA"]
}
```

## Incognito / private-window retest

1. Global sign-out user.
2. Private window → dashboard login → Cognito managed login.
3. Complete TOTP setup and sign-in.
4. Decode access token **locally** (do not paste tokens into tickets): confirm `tenant_id` still present; confirm whether `mfa_session_verified` is present (expected: **absent** until session-assurance work ships).
5. Attempt privileged API (e.g. tenant create): expect **403 MFA_EVIDENCE_UNAVAILABLE** until claim injection is implemented — **by design**.

## Rollback plan (IaC)

1. Revert **`MfaConfiguration`** to the prior reviewed value (`OPTIONAL`, `OFF`, etc.) in `infrastructure/auth/template.yaml`.
2. In the **same** deployment, set **`SisumPreTokenGenerationFunction`** → **`Environment.Variables.COGNITO_REQUIRED_MFA`** to **`'false'`** or **remove** the variable. **Do not** leave **`COGNITO_REQUIRED_MFA: 'true'`** while lowering pool MFA: Hosted Auth would **continue** emitting **`mfa_session_verified`**, which is **unsafe** and inconsistent with optional/off pool MFA.
3. Deploy the auth stack change set; verify live pool MFA and Lambda environment match the template.
4. **Warning:** Setting MFA to `OFF` or `OPTIONAL` is a **security regression**; requires security review.
5. **Never** delete/recreate the user pool to roll back; use in-place stack update only.

Automated guard: `backend/tests/unit/auth-template-mfa-consistency.test.ts` fails if **`MfaConfiguration: ON`** and **`COGNITO_REQUIRED_MFA`** diverge.

## Repository validation commands

```bash
cd backend
npm run build
npx tsx --test tests/unit/pre-token-generation.test.ts tests/unit/identity.test.ts tests/unit/privileged-mfa.test.ts
npm test
sam validate --lint
sam build
npx tsx scripts/validate-cognito-mfa-offline.ts   # requires COGNITO_* env vars per script
```

Auth template (standalone CloudFormation):

```bash
sam validate --lint --template ../infrastructure/auth/template.yaml
```

## Remaining risks

| Risk | Mitigation |
|------|------------|
| Users without TOTP cannot sign in after `ON` | Communicate enrollment window; global sign-out + guided setup |
| Live pool drift vs stack | Change-set review; verify `UserPoolId` output |
| Privileged APIs still blocked post-TOTP | Planned `mfa_session_verified` design; do not bypass middleware |
| Viewers/analysts also require TOTP | Acceptable tradeoff for `ON`; document in release notes |
