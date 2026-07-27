# SISU'M backend DynamoDB deploy recovery

## Failed stack update with retained membership tables

A backend CloudFormation deployment can fail while creating `SisumMembershipsTable` or
`SisumInvitationsTable` (physical names such as `sisum-memberships-production` and
`sisum-invitations-production`). When those resources use a **Retain** deletion policy,
CloudFormation may report:

```text
DELETE_SKIPPED SisumMembershipsTable
DELETE_SKIPPED SisumInvitationsTable
```

The stack can roll back to `UPDATE_ROLLBACK_COMPLETE` while the physical tables remain
in the account as **orphans** (not tracked by the rolled-back stack).

Before retrying deployment, confirm the GitHub OIDC role policy includes
`dynamodb:DescribeTable` (and related table-management actions) for
`sisum-memberships-*` and `sisum-invitations-*`, then update the
`sisum-backend-deploy-role-support` stack from
`infrastructure/backend/deployment-role-audit-policy.yaml`.

## Inspect retained tables

```bash
aws dynamodb describe-table \
  --table-name sisum-memberships-production \
  --region us-east-1

aws dynamodb describe-table \
  --table-name sisum-invitations-production \
  --region us-east-1
```

Review `TableStatus`, `ItemCount`, tags, and creation time. Only proceed with deletion
when **all** of the following are true:

- The table exists and is `ACTIVE`.
- `ItemCount` is **0** (or you have confirmed no application data was written).
- The table was created by the failed deployment attempt and is **not** owned by a
  healthy stack you intend to keep.

**Never delete either table if it contains real membership or invitation data.** Use
CloudFormation resource import or a controlled recovery plan if data exists.

Do not automate production table deletion from CI.

## Remove empty orphan tables (manual, controlled)

After operator confirmation:

```bash
aws dynamodb delete-table \
  --table-name sisum-memberships-production \
  --region us-east-1

aws dynamodb wait table-not-exists \
  --table-name sisum-memberships-production \
  --region us-east-1

aws dynamodb delete-table \
  --table-name sisum-invitations-production \
  --region us-east-1

aws dynamodb wait table-not-exists \
  --table-name sisum-invitations-production \
  --region us-east-1
```

Then redeploy the backend stack.

## Deployment is not fixed until

1. IAM policy sources in this repository are merged or otherwise approved.
2. The deploy-role support stack is updated in AWS.
3. IAM simulation allows `dynamodb:DescribeTable` (and required create/update actions)
   on both table ARN patterns.
4. Empty retained orphans are handled safely (or confirmed absent).
5. The backend CloudFormation deployment completes successfully.
