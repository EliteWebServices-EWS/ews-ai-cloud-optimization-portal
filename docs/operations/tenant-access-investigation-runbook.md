# Tenant Access Investigation Runbook

## When to use

- CloudWatch alarm `sisum-{env}-tenant-access-denied` fires
- Repeated `tenant.access_denied` events in logs
- Customer report of "not found" for known resources

## CloudWatch Logs Insights queries

### Recent cross-tenant denials

```
fields @timestamp, eventName, tenantId, resourceTenantId, actor.userId, actor.email, path, resource.type, resource.id, reason
| filter eventName = "tenant.access_denied"
| sort @timestamp desc
| limit 50
```

### Fallback usage (migration monitoring)

```
fields @timestamp, eventName, tenantId, actor.userId, reason
| filter eventName in ["tenant.claim_missing", "tenant.fallback_used"]
| stats count() by eventName, bin(5m)
```

### Correlate by user

```
fields @timestamp, eventName, tenantId, path, resource.id
| filter actor.userId = "<user-sub>"
| filter eventName like /^tenant\./
| sort @timestamp desc
```

## Investigation steps

1. Confirm alarm threshold (≥5 denials in 5 minutes) — rule out single mis-click
2. Identify `actor.userId` and `tenantId` (requesting tenant) from denial events
3. Use audit-only `resourceTenantId` (internal tools only) to confirm which tenant owns the resource
4. Check whether user has correct `custom:tenantId` in Cognito
5. Verify requested resource ID belongs to user's tenant (internal admin tools only)
6. If attack pattern (many IDs, many tenants): escalate per security incident runbook
7. If misconfiguration: assign correct tenant attribute; verify strict mode readiness

## False positive scenarios

- User bookmarked resource from prior shared MVP period before tenant assignment
- Integration test traffic in non-production environments

## Escalation

Follow [security-incident-response-runbook.md](./security-incident-response-runbook.md) if deliberate cross-tenant probing is suspected.
