# Credential Rotation Runbook — SISU'M

## Purpose

Define rotation procedures for credentials and trust relationships used by the SISU'M platform.

## Current credential inventory

| Item | Type | Rotation needed |
|------|------|-----------------|
| Cognito user passwords | User credential | On compromise or policy |
| Cognito TOTP MFA | User credential | On device loss — re-enroll |
| Cognito app client | Public identifier | Not rotated (no client secret) |
| Lambda execution role | IAM role | Policy review quarterly |
| GitHub OIDC deploy roles | IAM role + trust | Trust policy review quarterly |
| ACM certificates | AWS-managed renewal | Automatic |
| API Gateway JWT validation | Cognito JWKS | Automatic rotation by Cognito |

**No long-lived AWS access keys** are stored in the repository or Lambda environment.

## Cognito user password rotation

### User-initiated

Users change password through Cognito managed login when logged in.

### Admin-forced reset

```bash
aws cognito-idp admin-reset-user-password \
  --user-pool-id us-east-1_DARrpLb5p \
  --username "<username>"
```

User receives temporary password and must set a new password on next login.

### After compromise

1. Disable user immediately
2. Admin reset password
3. Require TOTP re-enrollment if MFA device untrusted
4. Review audit logs for activity during compromise window

## TOTP MFA rotation

1. Admin removes MFA device: `admin-set-user-mfa-preference` with software token disabled
2. User re-enrolls via Cognito managed login MFA setup
3. Verify successful login before restoring privileged group access

## GitHub OIDC deployment role review

Quarterly:

1. Verify OIDC trust policy restricts expected repository and branch/environment
2. Confirm `allowed-account-ids` in deploy workflow
3. Review `SisumBackendDeployRole` and frontend deploy role policies
4. Remove unused permissions

No secret rotation required for OIDC — trust is certificate-based.

## IAM policy rotation

When tightening policies:

1. Update CloudFormation template or IAM policy JSON
2. Deploy via approved pipeline
3. Monitor Lambda and deploy workflows for `AccessDenied` errors
4. Roll back if production impact detected

## Secrets Manager

**Not currently used.** When the first actual secret is introduced (e.g., third-party API key):

1. Store in AWS Secrets Manager
2. Grant Lambda `secretsmanager:GetSecretValue` with resource-scoped policy
3. Document rotation schedule in this runbook
4. Enable automatic rotation if supported by secret type

## Evidence and documentation

Record rotation events in change management ticket with:

- Date and operator
- Affected identities
- Verification steps performed
