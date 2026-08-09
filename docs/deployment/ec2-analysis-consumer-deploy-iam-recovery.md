# EC2 analysis consumer deploy — IAM recovery (Sprint 15)

## Failure summary (historical — role lifecycle)

CloudFormation failed creating `SisumEc2AnalysisConsumerExecutionRole` because
`SisumBackendDeployRole` lacked `iam:GetRole` on that role. Rollback then failed
to delete the role because `iam:DetachRolePolicy` was also missing on the deploy role.

Runtime policies on the consumer role are **`AWS::IAM::Policy`** resources in
`backend/template.yaml` (inline role policies). CloudFormation therefore also needs
`iam:PutRolePolicy`, `iam:GetRolePolicy`, `iam:DeleteRolePolicy`, and
`iam:ListRolePolicies` on `SisumEc2AnalysisConsumerExecutionRole` — not
`iam:CreatePolicy` on standalone policy ARNs.

**Status:** After applying `SisumBackendDeployConsumerExecutionRole` with those IAM
actions, deployment progressed past role creation, inline runtime policies, and
Lambda function creation.

## Failure summary (current — event source mapping)

CloudFormation failed creating:

- **Logical ID:** `SisumEc2AnalysisConsumerFunctionEc2IntelligenceQueueEvent`
- **Type:** `AWS::Lambda::EventSourceMapping`

**Error:** `SisumBackendDeployRole` is not authorized to perform
`lambda:CreateEventSourceMapping` (initial fix attempt used an unsupported
`event-source-mapping:*` resource ARN and IAM simulation returned **implicitDeny**
even with the correct `lambda:FunctionArn` context).

This is a **deployment-control-plane** permission on `SisumBackendDeployRole`.
It is **not** fixed by changing `SisumEc2AnalysisConsumerExecutionRole` or
`SisumEc2IntelligenceQueueConsumePolicy` (runtime SQS consume permissions).

Rollback completed successfully; consumer role, function, log group, consume policy,
and event source mapping were removed. Stack state: **`UPDATE_ROLLBACK_COMPLETE`**.

Do **not** run `continue-update-rollback` unless the stack enters
`UPDATE_ROLLBACK_FAILED`.

## Event source mapping deploy permissions

Per [AWS Lambda identity-based policy examples](https://docs.aws.amazon.com/lambda/latest/dg/permissions-user-function.html)
and the [Lambda API permissions reference](https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html):

| Action | IAM resource in policy | `lambda:FunctionArn` condition |
|--------|------------------------|--------------------------------|
| `lambda:CreateEventSourceMapping` | **`"*"`** (required) | **Yes** — restrict to consumer function prefix |
| `lambda:UpdateEventSourceMapping` | **`"*"`** with condition (AWS documents write pattern) | **Yes** |
| `lambda:DeleteEventSourceMapping` | **`"*"`** with condition (AWS documents write pattern) | **Yes** |
| `lambda:GetEventSourceMapping` | **`"*"`** | **No** (not listed as a supported condition for read) |
| `lambda:ListEventSourceMappings` | **`"*"`** | **No** |

**Do not** scope `CreateEventSourceMapping` to `arn:...:event-source-mapping:*`. That ARN
format is not valid for the create authorization check; IAM evaluates **`Resource: "*"`**
plus **`lambda:FunctionArn`** for create/update/delete.

**Write statement (effective least privilege AWS supports):**

```json
{
  "Sid": "ManageSisumEc2AnalysisConsumerEventSourceMapping",
  "Effect": "Allow",
  "Action": [
    "lambda:CreateEventSourceMapping",
    "lambda:UpdateEventSourceMapping",
    "lambda:DeleteEventSourceMapping"
  ],
  "Resource": "*",
  "Condition": {
    "StringLike": {
      "lambda:FunctionArn": "arn:aws:lambda:us-east-1:739275446782:function:sisum-ec2-analysis-consumer-*"
    }
  }
}
```

Although `Resource` is `"*"`, **writes are limited to mappings for**
`sisum-ec2-analysis-consumer-*` functions via the condition (matches
`FunctionName: sisum-ec2-analysis-consumer-${Environment}` in `backend/template.yaml`).

**Read statement:**

```json
{
  "Sid": "ReadSisumEc2AnalysisConsumerEventSourceMappings",
  "Effect": "Allow",
  "Action": [
    "lambda:GetEventSourceMapping",
    "lambda:ListEventSourceMappings"
  ],
  "Resource": "*"
}
```

Read/list are broader at the IAM API level (no function condition). CloudFormation deploy
uses them for mapping discovery and drift; restrict deploy role assumption to CI/admin only.

`lambda:TagResource` / `UntagResource` / `ListTags` on event source mappings were **not**
added — not required for this template failure.

## Live state constraints

- `SisumBackendDeployRole` already has inline policy **`SisumBackendDeployAuditResources`**
  (and other deploy policies). **Do not replace** that document with the consumer JSON.
- Live **`SisumBackendDeployConsumerExecutionRole`** was applied via **`aws iam put-role-policy`**.
  **`put-role-policy` replaces the entire inline policy document** for that policy name.
  You must apply the **complete** JSON from the repository (all prior IAM fixes **plus**
  event source mapping statements).
- Main backend Lambda deploy permissions (for example on a separate managed
  `SisumBackendDeploymentPolicy`) remain unchanged; this fix extends only
  **`SisumBackendDeployConsumerExecutionRole`**.

## Fix deploy-role permissions (required before redeploy)

### Option A — CloudFormation supplemental stack

```bash
aws cloudformation deploy \
  --template-file infrastructure/backend/deployment-role-audit-policy.yaml \
  --stack-name sisum-backend-deploy-audit-policy \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

Creates/updates **`SisumBackendDeployAuditResources`** and
**`SisumBackendDeployConsumerExecutionRole`** as separate inline policies. Coordinate
with an administrator if audit permissions already exist only in live IAM.

### Option B — Manual update (consumer inline policy only)

Apply the **full** policy document (not a partial fragment):

```bash
aws iam put-role-policy \
  --role-name SisumBackendDeployRole \
  --policy-name SisumBackendDeployConsumerExecutionRole \
  --policy-document file://infrastructure/iam/sisum-backend-deploy-consumer-execution-role-policy.json \
  --region us-east-1
```

Requires **`iam:PutRolePolicy`** on `SisumBackendDeployRole` (typically an administrator).

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
```

Confirm the document still includes all **IAM role lifecycle** and **PassRole** statements
**and** write EventSourceMapping actions on **`Resource: "*"`** with **`lambda:FunctionArn`**
for `sisum-ec2-analysis-consumer-*`, plus read **`GetEventSourceMapping`** / **`ListEventSourceMappings`**
on **`Resource: "*"`** without a function condition.

## IAM policy simulation (read-only; run as a principal allowed to simulate)

Use after the corrected policy is applied. **`CreateEventSourceMapping` must be simulated
with `Resource: "*"` and context key `lambda:FunctionArn`**, not `event-source-mapping:*`.

**Write actions (expect `allowed`):**

```bash
DEPLOY_ROLE_ARN="arn:aws:iam::739275446782:role/SisumBackendDeployRole"
CONSUMER_FN_ARN="arn:aws:lambda:us-east-1:739275446782:function:sisum-ec2-analysis-consumer-production"

aws iam simulate-principal-policy \
  --policy-source-arn "$DEPLOY_ROLE_ARN" \
  --action-names \
    lambda:CreateEventSourceMapping \
    lambda:UpdateEventSourceMapping \
    lambda:DeleteEventSourceMapping \
  --resource-arns "*" \
  --context-entries \
    "ContextKeyName=lambda:FunctionArn,ContextKeyValues=$CONSUMER_FN_ARN,ContextKeyType=string" \
  --region us-east-1
```

**Read actions (expect `allowed`; no FunctionArn context required by IAM):**

```bash
aws iam simulate-principal-policy \
  --policy-source-arn "$DEPLOY_ROLE_ARN" \
  --action-names \
    lambda:GetEventSourceMapping \
    lambda:ListEventSourceMappings \
  --resource-arns "*" \
  --region us-east-1
```

## Orphan resources after rollback

Successful rollback for the event-source failure **removed** the consumer role, function,
log group, policies, and mapping. **`NoSuchEntity`** on consumer role/function checks is
expected before the next deploy.

## What was not changed

- `SisumEc2AnalysisConsumerExecutionRole` runtime permissions (SQS consume, DynamoDB, STS)
- Application consumer logic, leases, queue settings (visibility 1800, timeout 300, batch 1, DLQ)
