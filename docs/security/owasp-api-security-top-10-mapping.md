# OWASP API Security Top 10 (2023) Mapping — SISU'M

**Disclaimer:** Mapping of implemented controls to OWASP categories. Not a penetration test report.

| # | Risk | Status | SISU'M controls |
|---|------|--------|-----------------|
| API1 | Broken Object Level Authorization | Partially implemented | RBAC by route; single-tenant MVP — no object-level tenant isolation |
| API2 | Broken Authentication | Implemented | Cognito + API Gateway JWT + token_use validation |
| API3 | Broken Object Property Level Authorization | Partially implemented | Response schemas exclude internal fields; no granular property ACL |
| API4 | Unrestricted Resource Consumption | Implemented | API Gateway throttling, Lambda concurrency cap, JSON size limit, audit query limit |
| API5 | Broken Function Level Authorization | Implemented | `requireAnyRole` on routes; admin-only audit API |
| API6 | Unrestricted Access to Sensitive Business Flows | Partially implemented | Workflow/report endpoints require analyst role; no step-up auth |
| API7 | Server Side Request Forgery | Not applicable | Mock provider; no user-controlled outbound URLs |
| API8 | Security Misconfiguration | Implemented | CORS allowlist, security headers, no wildcard production CORS |
| API9 | Improper Inventory Management | Partially implemented | `/api/v1/plugins`, `/providers` discovery; API spec in docs |
| API10 | Unsafe Consumption of APIs | Not applicable | Backend does not consume untrusted third-party APIs in mock mode |

## Sprint 10.5.15 enhancements by category

### API2 — Broken Authentication

- Email claim normalization
- Unknown role rejection with audit trail
- Non-access token rejection in Lambda

### API4 — Unrestricted Resource Consumption

- 256 KB JSON body limit
- API Gateway 50 req/s steady, 100 burst
- Lambda reserved concurrency 25
- Audit query max 100 records

### API5 — Broken Function Level Authorization

- `ROLE_UNRECOGNIZED` before role permission check
- Structured audit on all authorization failures

### API8 — Security Misconfiguration

- Explicit production CORS origins
- Security response headers on all API responses
- Removed unused DynamoDB GetItem permission

## Deferred

- API1 full object-level authorization for multi-tenant resources
- API6 step-up authentication for destructive operations
- Edge rate limiting via AWS WAF

## Testing coverage

Unit tests validate CORS, headers, input validation, identity extraction, and RBAC middleware. Integration tests cover workflow orchestration. No DAST tooling in CI currently.
