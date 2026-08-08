# EC2 discovery runbook

## Prerequisites

- AWS account **VERIFIED** (Sprint 13).
- Customer role includes EC2 **Describe*** actions listed in [security doc](../security/ec2-discovery-security.md).

## Start discovery

`POST /api/v1/aws-accounts/{accountId}/ec2/discovery`

```json
{ "regions": ["us-east-1"] }
```

Omit `regions` to use the registered account region. Response **200** with run summary (synchronous).

## List inventory

`GET /api/v1/ec2/resources?accountId=...&region=...&resourceType=INSTANCE&limit=25&nextToken=...`

## Summary

`GET /api/v1/ec2/resources/summary?accountId=...`

## Rollback

- Stop calling discovery; inventory rows remain until TTL/policy defines retention (future).
- Revoke customer IAM trust to stop AWS reads (Sprint 13 runbook).

## Troubleshooting — deployment `DescribeTable` AccessDenied

If CloudFormation fails when adding or updating `sisum-cloud-resources-*`:

1. Inspect the **live** inline policy `SisumBackendDeployDynamoDBPolicy` on `SisumBackendDeployRole` (repository JSON does not auto-sync to IAM).
2. Confirm the policy includes `arn:aws:dynamodb:us-east-1:739275446782:table/sisum-cloud-resources-*` (adjust account/region if deploying elsewhere).
3. Run IAM policy simulation for the deploy principal: `dynamodb:DescribeTable`, `CreateTable`, `UpdateTable`, `DeleteTable` on that ARN pattern.
4. Confirm stack status (`UPDATE_ROLLBACK_COMPLETE` after a failed attempt, then `UPDATE_COMPLETE` after fix).
5. Confirm the failed table name is **absent** in DynamoDB if rollback removed it.
6. Apply the live policy update through the approved admin path and rerun deployment.

Details: [EC2 production validation — deployment IAM recovery](../validation/ec2-discovery-validation.md#deployment-role-iam-issue-and-recovery).
