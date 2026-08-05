# Tenant identity alignment

## Alignment chain

| Step | System | Value |
|------|--------|--------|
| 1 | Tenant registry | Generated `tenantId` |
| 2 | Cognito profile | `custom:tenantId` = same id |
| 3 | Access token (after re-login) | `tenant_id` claim (Pre Token Gen) |
| 4 | Bootstrap | Trusted `tenant_id` must match registry **ACTIVE** tenant |

## Cognito update scope

Only **`custom:tenantId`** is written via `AdminUpdateUserAttributes`. No other attributes, no tokens stored or logged.

## Owner identifier

`ownerUserId` on create must be the Cognito **`sub`** (same value as `x-sisum-user-id` / JWT `sub`), used as the Cognito `Username` for admin API calls.

## IAM

Lambda role: `cognito-idp:AdminUpdateUserAttributes` on
`arn:aws:cognito-idp:{region}:{account}:userpool/{CognitoUserPoolId}` only.

## JWT immutability

Already-issued access tokens are not updated. Reauthentication is mandatory after onboarding.

## Saga (non-atomic)

DynamoDB create and Cognito update are separate steps. Cognito failure → **PROVISIONING** remains; retry via complete-onboarding.
