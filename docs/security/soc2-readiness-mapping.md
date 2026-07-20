# SOC 2 Readiness Mapping — SISU'M

**Disclaimer:** This document is a readiness mapping only. The SISU'M platform is **not SOC 2 certified**.

Legend: **Implemented** | **Partially implemented** | **Planned** | **Not applicable**

## CC6 — Logical and Physical Access Controls

| Control area | Status | Evidence |
|--------------|--------|----------|
| Authentication (Cognito) | Implemented | `infrastructure/auth/template.yaml` |
| MFA for privileged users | Partially implemented | Optional TOTP + operational enforcement |
| RBAC (viewer/analyst/admin) | Implemented | `backend/auth/require-role.ts` |
| JWT validation | Implemented | API Gateway authorizer |
| IAM least privilege | Partially implemented | Sprint 10.5.15 IAM review |
| GitHub access control | Partially implemented | Branch protection + environment reviewers |

## CC7 — System Operations

| Control area | Status | Evidence |
|--------------|--------|----------|
| Monitoring and alerting | Implemented | `infrastructure/monitoring/template.yaml` |
| Security event logging | Implemented | Audit events + DynamoDB persistence |
| Incident response | Implemented | `docs/operations/security-incident-response-runbook.md` |
| Vulnerability management | Partially implemented | npm audit documented |
| API throttling | Implemented | API Gateway route settings |

## CC8 — Change Management

| Control area | Status | Evidence |
|--------------|--------|----------|
| CI/CD pipeline | Implemented | `.github/workflows/deploy-backend.yml` |
| Production environment protection | Implemented | GitHub `production` environment |
| Infrastructure as code | Implemented | CloudFormation/SAM templates |
| Rollback procedures | Implemented | Sprint 10.5.15 hardening doc |

## CC9 — Risk Mitigation

| Control area | Status | Evidence |
|--------------|--------|----------|
| Threat modeling | Implemented | `docs/security/threat-model.md` |
| Risk assessment | Partially implemented | STRIDE analysis |
| WAF / edge protection | Planned | Deferred sprint |

## A1 — Availability

| Control area | Status | Evidence |
|--------------|--------|----------|
| CloudWatch alarms | Implemented | Lambda, API, CloudFront alarms |
| DynamoDB PITR | Implemented | Audit table template |
| Health checks | Implemented | Public health route |

## C1 — Confidentiality

| Control area | Status | Evidence |
|--------------|--------|----------|
| Encryption at rest | Implemented | S3 SSE, DynamoDB SSE |
| Encryption in transit | Implemented | HTTPS everywhere |
| Secrets management | Planned | No secrets in scope yet |
| Log redaction | Implemented | Audit schema excludes secrets |

## P1 — Privacy

| Control area | Status | Evidence |
|--------------|--------|----------|
| User email in audit | Partially implemented | Actor email from Cognito claim |
| Data retention | Implemented | Audit TTL 365 days |

## Vendor management

| Vendor | Status | Notes |
|--------|--------|-------|
| AWS | Implemented | Primary cloud provider |
| GitHub | Implemented | Source control and CI |
| Cognito | Implemented | Identity provider |

## Summary

The platform has foundational controls suitable for SOC 2 readiness discussions. Gaps include certified MFA enforcement for all privileged users, WAF, formal penetration testing, and documented vendor risk assessments.
