# EC2 analysis consumer deploy — IAM recovery (Sprint 15)

## Failure summary

CloudFormation failed creating `SisumEc2AnalysisConsumerExecutionRole` because
`SisumBackendDeployRole` lacked `iam:GetRole` on that role. Rollback then failed
to delete the role because `iam:DetachRolePolicy` was also missing on the deploy role.

Runtime policies on the consumer role are **`AWS::IAM::Policy`** resources in
`backend/template.yaml` (inline role policies). CloudFormation therefore also needs
`iam:PutRolePolicy`, `iam:GetRolePolicy`, `iam:DeleteRolePolicy`, and
`iam:ListRolePolicies` on `SisumEc2AnalysisConsumerExecutionRole` — not
`iam:CreatePolicy` on standalone policy ARNs.

Stack state after rollback: **`UPDATE_ROLLBACK_COMPLETE`** (not `UPDATE_ROLLBACK_FAILED`).

Do **not** run `continue-update-rollback` unless the stack enters
`UPDATE_ROLLBACK_FAILED`.

## Live state constraints

- `SisumBackendDeployRole` already has inline policy **`SisumBackendDeployAuditResources`**
  (and other deploy policies). **Do not replace** that document with the consumer JSON.
- Stack **`sisum-backend-deploy-audit-policy`** may not exist yet; applying the template
  adds a **second** inline policy on the deploy role: **`SisumBackendDeployConsumerExecutionRole`**.
- Consumer execution role **`SisumEc2AnalysisConsumerExecutionRole`** may not exist yet
  (`NoSuchEntity` is OK before first successful deploy).

## Fix deploy-role permissions (required before redeploy)

### Option A — CloudFormation (preferred when an administrator can deploy the stack)

```bash
aws cloudformation deploy \
  --template-file infrastructure/backend/deployment-role-audit-policy.yaml \
  --stack-name sisum-backend-deploy-audit-policy \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

This manages **`SisumBackendDeployAuditResources`** and **`SisumBackendDeployConsumerExecutionRole`**
as separate inline policies on `SisumBackendDeployRole`. If audit permissions already exist
only in live IAM, coordinate with an administrator before first stack create/update so existing
audit grants are not accidentally narrowed.

### Option B — Manual bootstrap (add consumer policy only)

Use when the audit inline policy must remain untouched and only the consumer deploy grant is missing:

```bash
aws iam put-role-policy \
  --role-name SisumBackendDeployRole \
  --policy-name SisumBackendDeployConsumerExecutionRole \
  --policy-document file://infrastructure/iam/sisum-backend-deploy-consumer-execution-role-policy.json \
  --region us-east-1
```

Requires an IAM principal with **`iam:PutRolePolicy`** on `SisumBackendDeployRole` (for example
an account administrator). The local user `ObianujuFlorence` may **not** have that permission.

Repository mirror for review:

`infrastructure/iam/sisum-backend-deploy-consumer-execution-role-policy.json`

## Read-only preflight (no IAM writes)

```bash
aws sts get-caller-identity

aws iam list-role-policies --role-name SisumBackendDeployRole

aws iam get-role-policy \
  --role-name SisumBackendDeployRole \
  --policy-name SisumBackendDeployConsumerExecutionRole \
  2>&1 || true

aws iam get-role --role-name SisumEc2AnalysisConsumerExecutionRole 2>&1 || true
```

## Verification after apply (read-only)

```bash
aws iam get-role-policy \
  --role-name SisumBackendDeployRole \
  --policy-name SisumBackendDeployConsumerExecutionRole

aws iam get-role-policy \
  --role-name SisumBackendDeployRole \
  --policy-name SisumBackendDeployAuditResources
```

Confirm the consumer policy document includes `iam:GetRole`, `iam:DetachRolePolicy`,
`iam:PutRolePolicy`, `iam:GetRolePolicy`, `iam:DeleteRolePolicy`, `iam:ListRolePolicies`,
and `iam:PassRole` with `lambda.amazonaws.com`.

## Orphan role check (do not redeploy blindly)

```bash
aws iam get-role --role-name SisumEc2AnalysisConsumerExecutionRole

aws iam list-attached-role-policies \
  --role-name SisumEc2AnalysisConsumerExecutionRole

aws iam list-role-policies \
  --role-name SisumEc2AnalysisConsumerExecutionRole
```

### If `get-role` returns `NoSuchEntity`

- Safe to run backend **`sam deploy`** after deploy-role permissions are applied.

### If `get-role` succeeds

- Reconcile per prior rollback guidance before **`CreateRole`** hits **`EntityAlreadyExists`**.

## What was not changed

- `SisumEc2AnalysisConsumerExecutionRole` runtime permissions (SQS consume, DynamoDB, STS)
- Application consumer logic, leases, or queue settings
