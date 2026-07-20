# Security Monitoring Runbook — SISU'M

## Purpose

Operational guide for security-related CloudWatch monitoring, alarms, and log queries.

## Dashboard

**Name:** `SISUM-production-Operations`

Includes Lambda, API Gateway, CloudFront, S3, and alarm status widgets.

## Security alarms

| Alarm | Threshold | Tuning notes |
|-------|-----------|--------------|
| `sisum-production-authorization-denials` | ≥ 25 / 5 min | Lower for stricter environments |
| `sisum-production-api-high-4xx` | ≥ 100 / 5 min (2 periods) | Includes 401, 403, 429 |
| `sisum-production-lambda-errors` | ≥ 1 / 5 min | Investigate immediately |
| `sisum-production-audit-persistence-failures` | ≥ 1 / 5 min | Data integrity risk |
| `sisum-production-audit-table-throttles` | ≥ 1 / 5 min | Capacity or hot partition |

## Correlation ID investigation

```
fields @timestamp, eventName, outcome, requestId, correlationId, actor.userId, path, statusCode, reason
| filter correlationId = "<correlation-id>"
| sort @timestamp asc
```

Replace `<correlation-id>` with value from API response header `X-Correlation-Id` or audit record.

## CloudWatch Logs Insights queries

Log group: `/aws/lambda/sisum-backend-production`

### 401 responses

```
fields @timestamp, eventName, outcome, actor.userId, path, statusCode, reason, correlationId
| filter statusCode = 401 or eventName = "identity.missing"
| sort @timestamp desc
| limit 50
```

### 403 responses

```
fields @timestamp, eventName, outcome, actor.userId, actor.roles, path, statusCode, reason, correlationId
| filter statusCode = 403 or eventName in ["authorization.denied", "role.unrecognized"]
| sort @timestamp desc
| limit 50
```

### 429 responses (API Gateway)

API Gateway 429 responses may not reach Lambda. Monitor:

- CloudWatch metric `AWS/ApiGateway` `4xx` for API ID `zqe6cl0m15`
- Alarm `sisum-production-api-high-4xx`

### 5xx responses

```
fields @timestamp, eventName, outcome, path, statusCode, reason, correlationId
| filter statusCode >= 500 or eventName = "request.failed"
| sort @timestamp desc
| limit 50
```

### Unknown roles

```
fields @timestamp, actor.userId, actor.email, actor.roles, path, reason, correlationId
| filter eventName = "role.unrecognized"
| sort @timestamp desc
| limit 50
```

### Failed workflows

```
fields @timestamp, eventName, workflowId, actor.userId, reason, errorCode, correlationId
| filter eventName = "workflow.failed"
| sort @timestamp desc
| limit 50
```

### Audit persistence failures

```
fields @timestamp, eventName, reason, requestId, correlationId
| filter eventName = "audit.persistence_failed"
| sort @timestamp desc
| limit 50
```

## Custom metrics

| Namespace | Metric | Source |
|-----------|--------|--------|
| `SISUM/Audit` | `AuditPersistenceFailures` | Metric filter on audit logs |
| `SISUM/Security` | `AuthorizationDenials` | Metric filter on authorization events |

## Response procedures

| Alarm fires | Action |
|-------------|--------|
| Authorization denials | Check for credential stuffing or misconfigured client; see incident runbook |
| High 4xx | Distinguish auth failures vs throttling via logs and request patterns |
| Lambda errors | Check recent deployments and error stack in logs (no body logging) |
| Audit persistence failure | Verify DynamoDB table health and IAM permissions |

## Assumptions

- Normal dashboard usage generates occasional 401 during session refresh
- Penetration testing may trigger authorization denial alarms — notify ops in advance
- Tune thresholds after 30 days of production baseline metrics
