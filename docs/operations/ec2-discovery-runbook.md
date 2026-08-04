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
