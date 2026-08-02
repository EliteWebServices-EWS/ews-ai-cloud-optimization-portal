# AWS account onboarding runbook

## Discovery check

1. Register account (`POST /api/v1/aws-accounts`).
2. Configure customer role trust + read policy (see least-privilege doc).
3. `POST /api/v1/aws-accounts/:accountId/discovery` as Tenant Owner/Admin/Security Admin.
4. Confirm `discovery.accountId` matches registration and `metadata.discovery` persisted.

## Troubleshooting AccessDenied

- AssumeRole denied → trust policy / ExternalId mismatch.
- Optional warnings on alias/org → extend customer read policy or ignore if not needed.
- Identity mismatch (409) → wrong account registered; fix registration or role ARN.

## Rollback / disable

- Soft-delete connection: `DELETE /api/v1/aws-accounts/:accountId` (privileged MFA).
- Revoke customer role trust to platform when offboarding.

## Security

Temporary credentials live only in process memory via `StsCredentialProvider` cache; they are never persisted.
