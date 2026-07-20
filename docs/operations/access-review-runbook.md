# Access Review Runbook — SISU'M

## Purpose

Ensure least-privilege access across Cognito users, IAM roles, GitHub repository access, and deployment permissions.

## Review frequency

| Area | Frequency | Owner |
|------|-----------|-------|
| Cognito users and groups | Quarterly | Platform admin |
| IAM deployment roles | Quarterly | Platform admin |
| GitHub repository access | Quarterly | Repository admin |
| Production environment reviewers | Quarterly | Engineering lead |
| Privileged MFA enrollment | Quarterly | Security reviewer |

## Cognito users

1. Open Cognito User Pool `sisum-production-users`
2. Export or list all users
3. Verify each user has a business justification
4. Confirm group membership matches job function:
   - `viewer` — read-only dashboard access
   - `analyst` — workflow and report generation
   - `admin` — audit query and full access
5. Verify admin and analyst users have TOTP MFA enrolled
6. Disable or delete stale accounts

### Removal procedure

```bash
aws cognito-idp admin-user-global-sign-out \
  --user-pool-id us-east-1_DARrpLb5p \
  --username "<username>"

aws cognito-idp admin-disable-user \
  --user-pool-id us-east-1_DARrpLb5p \
  --username "<username>"
```

Delete only after retention period if required by policy.

## Cognito groups

- Confirm only `viewer`, `analyst`, `admin` groups exist
- Review group descriptions and precedence
- Remove users from groups before disabling accounts

## IAM roles

| Role | Purpose | Review focus |
|------|---------|--------------|
| `SisumLambdaExecutionRole` | Runtime API + audit persistence | No `Scan`, no table management |
| `SisumBackendDeployRole` | CloudFormation backend deploy | Scoped DynamoDB table ARNs |
| Frontend deploy role | S3/CloudFront deploy | No backend data access |

Document any retained wildcard permissions with justification.

## GitHub repository access

1. Review collaborators and team permissions on `EliteWebServices-EWS/ews-ai-cloud-optimization-portal`
2. Confirm branch protection on `main`
3. Verify production environment requires reviewers
4. Remove inactive contributors

## AWS deployment roles

1. Review OIDC trust policies for repository and environment conditions
2. Confirm `allowed-account-ids: 739275446782` in workflows
3. Verify no AdministratorAccess attached

## Production environment reviewers

GitHub `production` environment must require approval before backend/frontend deploy workflows execute.

## Evidence retention

Store access review checklist completion:

- Review date
- Reviewer name
- User/role inventory snapshot
- Remediation actions taken
- MFA verification notes for privileged users

Retain for minimum 12 months.
