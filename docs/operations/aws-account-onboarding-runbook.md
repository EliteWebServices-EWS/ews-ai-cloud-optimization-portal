# AWS account onboarding runbook

## Discovery check

1. Register account (`POST /api/v1/aws-accounts`).
2. Configure customer role trust + read policy (see least-privilege doc). Grant **all eight** mandatory EC2 discovery actions on the customer integration role (exact actions in `docs/security/ec2-discovery-security.md`).
3. `POST /api/v1/aws-accounts/:accountId/discovery` as Tenant Owner/Admin/Security Admin.
4. Confirm `discovery.accountId` matches registration and `metadata.discovery` persisted.

## Updating customer EC2 read permissions

When adding or changing EC2 discovery reads on an existing integration role:

1. Update the customer integration role with the **exact** required actions (no `ec2:*` or `ec2:Describe*` wildcards).
2. Re-run AWS account **verification** and confirm `permissionReport.allGranted` is true.
3. Re-run **EC2 discovery** per region.
4. Run **EC2 security analysis** and validate findings and dashboard scores.

## Troubleshooting AccessDenied

- AssumeRole denied → trust policy / ExternalId mismatch.
- Optional warnings on alias/org → extend customer read policy or ignore if not needed.
- Identity mismatch (409) → wrong account registered; fix registration or role ARN.

## Rollback / disable

- Soft-delete connection: `DELETE /api/v1/aws-accounts/:accountId` (privileged MFA).
- Revoke customer role trust to platform when offboarding.

## Security

Temporary credentials live only in process memory via `StsCredentialProvider` cache; they are never persisted.
