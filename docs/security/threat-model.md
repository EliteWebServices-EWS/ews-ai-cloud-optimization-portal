# SISU'M Threat Model (STRIDE)

**Status:** Sprint 10.5.15 — pre-customer launch  
**Scope:** Single-tenant MVP on AWS with mock provider mode

This document does **not** claim full multi-tenancy. Tenant isolation is logical (default tenant ID) rather than cryptographic partition.

## Assets

| Asset | Sensitivity |
|-------|-------------|
| Cognito user credentials and MFA devices | High |
| JWT access tokens | High |
| DynamoDB audit records | High |
| CloudWatch logs | Medium |
| Optimization workflow and report data | Medium |
| Frontend static assets (S3) | Low |
| CloudFormation / deployment templates | Medium |
| GitHub repository and OIDC trust | High |

## Actors

| Actor | Intent |
|-------|--------|
| Authenticated viewer/analyst/admin | Legitimate platform use |
| Unauthenticated internet user | Probe public endpoints |
| Compromised user account | Lateral movement, data access |
| Compromised deployment role | Infrastructure modification |
| Malicious dependency supply chain | Code execution |

## Entry points

- CloudFront → S3 frontend
- API Gateway HTTP API → Lambda Express backend
- Cognito managed login (OAuth/OIDC)
- GitHub Actions OIDC → AWS deploy roles
- Public `GET /api/v1/health`
- Public `OPTIONS` preflight routes

## Trust boundaries

```
[Browser] → [CloudFront/S3] → [Cognito Auth]
                ↓ Bearer JWT
         [API Gateway JWT Authorizer]
                ↓ validated claims
              [Lambda RBAC + Audit]
                ↓
         [DynamoDB Audit Store]
```

### Authentication boundary

API Gateway JWT authorizer validates issuer, audience, and expiry before Lambda executes (except health/OPTIONS).

### Tenant boundary

Single default tenant (`sisum-default`). Admin audit queries scoped by tenant context. No cross-tenant data stores exist today.

### AWS account boundary

All production resources in account `739275446782`. GitHub OIDC deploy roles restricted via `allowed-account-ids`.

## Data stores

| Store | Encryption | Access control |
|-------|------------|----------------|
| DynamoDB audit table | SSE enabled | IAM role-scoped Query/PutItem |
| S3 frontend bucket | AES256 | CloudFront OAC only |
| CloudWatch Logs | AWS-managed | IAM + log group policy |

## Threats and mitigations

| ID | STRIDE | Threat | Existing controls | Sprint 10.5.15 mitigations | Residual risk |
|----|--------|--------|-------------------|------------------------------|---------------|
| T1 | Spoofing | JWT theft and replay | HTTPS, short token TTL, API Gateway validation | token_use check, no client identity headers trusted | Stolen token valid until expiry |
| T2 | Tampering | Log tampering | Append-only audit pattern, CloudWatch immutability | Audit persistence monitoring | Admin AWS access could delete logs |
| T3 | Repudiation | Deny performing action | Structured audit events + DynamoDB persistence | Authorization denial logging | Client-side actions off-platform |
| T4 | Info disclosure | Secret leakage in logs | Audit schema excludes secrets | Security scan + tests | Developer error risk |
| T5 | DoS | API abuse | API Gateway + Lambda limits | Throttling 50 rps, concurrency cap 25 | Large distributed attack |
| T6 | Elevation | Privilege escalation via group manipulation | Cognito group assignment admin-only | ROLE_UNRECOGNIZED rejection | Compromised admin account |
| T7 | Info disclosure | Cross-tenant access | Single tenant MVP | Tenant ID on audit records | Future multi-tenant needs design |
| T8 | DoS | Malicious audit queries | Admin-only route, query limits | Max limit 100, validation | Expensive filtered queries |
| T9 | Spoofing | GitHub OIDC misuse | OIDC trust + environment protection | Documented access review | Misconfigured trust policy |
| T10 | Tampering | Deployment role compromise | Least privilege deploy role | IAM review, separated runtime role | Broad CFN permissions retained |
| T11 | Info disclosure | CORS misconfiguration | Allowlist origins | Dynamic validation + Vary header | Misconfigured env var |
| T12 | DoS | Oversized payloads | — | 256 KB JSON limit | Binary content types N/A |
| T13 | Spoofing | Dependency compromise | Lockfiles, CI | npm audit documented | Supply chain risk |
| T14 | Info disclosure | DynamoDB abuse | IAM Query/PutItem only | No Scan permission | Query volume cost |

## Deferred risks

| Risk | Planned mitigation |
|------|-------------------|
| Edge DDoS / bot traffic | AWS WAF (deferred sprint) |
| Group-specific MFA enforcement | Cognito custom auth Lambda (evaluate pre-launch) |
| Customer-managed KMS | Evaluate at enterprise tier |
| Real AWS provider credentials | Secrets Manager when activated |
| Full multi-tenant isolation | Architecture sprint |

## Required threat coverage checklist

- [x] JWT theft
- [x] Privilege escalation
- [x] Cross-tenant access (documented MVP limitation)
- [x] Malicious audit queries
- [x] Log tampering
- [x] DynamoDB abuse
- [x] Deployment role compromise
- [x] GitHub OIDC misuse
- [x] API abuse
- [x] Oversized payloads
- [x] CORS misconfiguration
- [x] Secret leakage
- [x] Dependency compromise
