# Tenant Boundary Threat Model

Sprint 10.5.16 — foundational tenant isolation for SISU'M.

## Assets

- Workflow records, reports, execution results, verification reports, learning records, audit events
- Cognito user identities with optional `custom:tenantId`

## Trust boundaries

```
Cognito JWT (custom:tenantId)
    → API Gateway JWT authorizer
    → Lambda identity header attachment
    → Express requireTenantContext middleware
    → RequestSecurityContext.tenantId
    → Stores / audit / orchestrator
```

## Threats and mitigations

### T1 — Tenant ID spoofing

**Attack:** Client sends `x-tenant-id` or `tenantId` in body/query to access another tenant.

**Mitigation:** Strip untrusted headers in Lambda; no API parser reads client tenant fields; repositories require server-resolved tenant.

### T2 — Cross-tenant direct object reference (IDOR)

**Attack:** Tenant B user guesses Tenant A workflow/report UUID.

**Mitigation:** Composite store keys; lookup requires both tenant and resource ID; mismatch returns empty result → 404; `tenant.access_denied` audit event when record exists under different tenant. Audit payload includes `tenantId` (requesting tenant) and audit-only `resourceTenantId` (owning tenant).

### T3 — Audit query lateral movement

**Attack:** Tenant admin queries audit events for another tenant via `tenantId` query param.

**Mitigation:** Query param rejected; partition key derived from authenticated tenant only.

### T4 — Missing claim fallback abuse

**Attack:** Attacker omits tenant claim to inherit default tenant and access shared MVP data.

**Mitigation:** Compatibility mode logs every fallback; strict mode rejects missing claims; strict required before external customers.

### T5 — Cognito tenant reassignment

**Attack:** Compromised admin reassigns user to victim tenant.

**Mitigation:** AdminCreateUserOnly pool; tenant assignment is administrator-controlled CLI/Console operation; reassignment documented as high-risk; audit Cognito admin API calls separately (future).

### T6 — Information disclosure via error messages

**Attack:** Infer another tenant's resource existence from 403 vs 404.

**Mitigation:** Cross-tenant resource lookups return 404 NOT_FOUND uniformly.

### T7 — Repository bypass

**Attack:** Developer calls `get(workflowId)` without tenant.

**Mitigation:** TypeScript interfaces require tenantId; code review; tests enforce cross-tenant denial.

## Residual risk

- In-memory stores reset on Lambda cold start (operational, not cross-tenant)
- No WAF (out of scope)
- Platform-wide audit visibility requires future platform-admin role design
