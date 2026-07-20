# Security Incident Response Runbook — SISU'M

## Purpose

Provide a repeatable procedure for detecting, containing, investigating, and recovering from security incidents affecting the SISU'M Cloud Optimization Portal.

## Detection

Monitor these signals:

| Signal | Source |
|--------|--------|
| Authorization denial spikes | CloudWatch alarm `sisum-production-authorization-denials` |
| API abuse / throttling | CloudWatch alarm `sisum-production-api-high-4xx` |
| Lambda errors | `sisum-production-lambda-errors` |
| Audit persistence failures | `sisum-production-audit-persistence-failures` |
| CloudFront 5xx | `sisum-production-cloudfront-5xx-rate` |
| Manual reports | Team members, customers, AWS notifications |

Initial triage query (CloudWatch Logs Insights):

```
fields @timestamp, eventName, outcome, actor.userId, actor.email, requestId, correlationId, path, statusCode, reason
| filter eventName in ["authorization.denied", "identity.missing", "role.unrecognized", "audit.persistence_failed"]
| sort @timestamp desc
| limit 100
```

## Severity classification

| Severity | Examples | Response time |
|----------|----------|---------------|
| **Critical** | Active credential compromise, data exfiltration, production outage from attack | Immediate |
| **High** | Privilege escalation attempt, sustained API abuse, deployment role misuse | < 1 hour |
| **Medium** | Elevated 401/403 rates, single-user anomaly | < 4 hours |
| **Low** | Isolated failed login, noisy alarm tuning needed | Next business day |

## Containment

1. Identify affected accounts, roles, and time window using correlation IDs.
2. Disable compromised Cognito users (see below).
3. Revoke active sessions by disabling user or changing password (forces re-auth).
4. If deployment credentials suspected: disable GitHub Actions workflow and rotate OIDC trust review.
5. Increase API Gateway throttling temporarily if under active abuse (CloudFormation parameter update).
6. Preserve evidence before destructive changes.

## Credential revocation

| Credential type | Action |
|-----------------|--------|
| Cognito user | Disable user in Cognito console or `admin-disable-user` |
| Cognito tokens | Disable user + revoke refresh tokens via `admin-user-global-sign-out` |
| IAM role session | No long-lived keys on Lambda; review CloudTrail for assumed-role activity |
| GitHub OIDC | Remove user/repo access; verify `allowed-account-ids` on deploy role |

## Cognito user disablement

```bash
aws cognito-idp admin-disable-user \
  --user-pool-id us-east-1_DARrpLb5p \
  --username "<cognito-username>"

aws cognito-idp admin-user-global-sign-out \
  --user-pool-id us-east-1_DARrpLb5p \
  --username "<cognito-username>"
```

## IAM session revocation

Lambda runtime uses execution roles — no static keys. For deployment role compromise:

1. Detach or restrict `SisumBackendDeployRole` policy via IAM
2. Review CloudTrail `AssumeRoleWithWebIdentity` events for GitHub OIDC
3. Invalidate active CloudFormation deployments if unauthorized changes detected

## Audit investigation

1. Query DynamoDB audit records via admin API (`GET /api/v1/admin/audit-events`) using filters for `actorUserId`, `correlationId`, time range.
2. Cross-reference CloudWatch Logs with same correlation ID.
3. Document timeline: authentication → authorization → workflow → persistence events.

## CloudTrail review

Review in AWS Console → CloudTrail:

- `AssumeRoleWithWebIdentity` (GitHub OIDC)
- IAM policy changes
- Cognito `Admin*` API calls
- CloudFormation stack updates

## CloudWatch review

- SISUM Operations dashboard
- Logs Insights queries in `docs/operations/security-monitoring-runbook.md`
- Alarm history for correlated timeframe

## DynamoDB audit review

Query parameters:

- `eventName=authorization.denied`
- `eventName=role.unrecognized`
- `actorUserId=<subject>`
- `from` / `to` ISO-8601 UTC bounds

## Communication

| Audience | Channel | Content |
|----------|---------|---------|
| Engineering | Internal chat / ticket | Technical timeline, containment status |
| Leadership | Email | Business impact, ETA |
| Affected users | Email (if applicable) | Password reset / re-enrollment instructions |

Do not disclose sensitive technical details publicly.

## Recovery

1. Re-enable services after threat neutralized
2. Reset passwords and re-enroll MFA for affected users
3. Redeploy known-good stack from last verified commit if tampering suspected
4. Tune alarm thresholds if false positive

## Post-incident review

Within 5 business days:

- Root cause analysis
- Control gaps identified
- Action items with owners
- Update threat model and runbooks

## Evidence preservation

1. Export CloudWatch log events for incident window to S3
2. Export relevant DynamoDB audit records
3. Screenshot alarm states and CloudTrail events
4. Store in restricted access location with retention per policy
