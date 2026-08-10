# Customer integration role trust policy

SISU'M assumes a **customer-owned** IAM role (commonly `SisumReadOnlyIntegrationRole`) in each connected AWS account. That role is **not** created by SISU'M CloudFormation; tenants create it using registration output and this documentation.

## Required trusted platform principals

The role trust policy must allow **`sts:AssumeRole`** from **both** platform execution roles:

| Role | Purpose |
|------|---------|
| `SisumLambdaExecutionRole` | API Lambda (sync discovery, verify, cost/security HTTP analysis) |
| `SisumEc2AnalysisConsumerExecutionRole` | EC2 async analysis SQS consumer (multi-stage pipeline) |

Use parameterized ARNs (replace `<PLATFORM_ACCOUNT_ID>` with the SISU'M hosting account):

- `arn:aws:iam::<PLATFORM_ACCOUNT_ID>:role/SisumLambdaExecutionRole`
- `arn:aws:iam::<PLATFORM_ACCOUNT_ID>:role/SisumEc2AnalysisConsumerExecutionRole`

## ExternalId (required)

Registration returns a tenant-specific **ExternalId**. The trust policy **must** include:

```json
"Condition": {
  "StringEquals": {
    "sts:ExternalId": "<EXTERNAL_ID_FROM_REGISTRATION>"
  }
}
```

Do **not** remove ExternalId, wildcard it, or trust `Principal: "*"`.

## Canonical policy builder

The backend exposes `buildSisumCustomerIntegrationRoleTrustPolicy()` in
`backend/services/aws-account-integration-trust-policy.ts`.

When `SISUM_PLATFORM_AWS_ACCOUNT_ID` is set on the API Lambda, **`POST /api/v1/aws-accounts`** includes `integrationRoleTrustPolicy` in the registration response (alongside the one-time unmasked `externalId`).

## Existing customer migration

Accounts onboarded **before** the async consumer trusted only `SisumLambdaExecutionRole`. EC2 async jobs fail with `ASSUME_ROLE_ACCESS_DENIED` from the consumer until the customer updates the role trust policy to include **both** principals while **keeping the same ExternalId**.

**One-time operator steps (customer account):**

1. IAM → Roles → integration role → Trust relationships → Edit trust policy.
2. Add `SisumEc2AnalysisConsumerExecutionRole` to the `Principal.AWS` list (or replace with the canonical JSON from a fresh registration example using the **existing** ExternalId).
3. Save. No change to permissions policy is required for trust-only fixes.
4. Allow the stuck SQS message to retry or submit a new analysis job.

## Security

- Never commit or log production ExternalId values.
- Revoke access by removing platform principals from the customer trust policy.
