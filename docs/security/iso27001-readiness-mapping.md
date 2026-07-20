# ISO 27001 Readiness Mapping — SISU'M

**Disclaimer:** This document is a readiness mapping only. The SISU'M platform is **not ISO 27001 certified**.

Legend: **Implemented** | **Partially implemented** | **Planned** | **Not applicable**

## A.5 — Information security policies

| Control | Status | Notes |
|---------|--------|-------|
| Security documentation | Implemented | Architecture and sprint security docs |
| Acceptable use | Planned | Formal policy document |

## A.8 — Asset management

| Control | Status | Notes |
|---------|--------|-------|
| Asset inventory | Partially implemented | CloudFormation-defined resources |
| Data classification | Implemented | Secrets vs configuration in 10.5.15 doc |

## A.9 — Access control

| Control | Status | Notes |
|---------|--------|-------|
| User registration/deregistration | Implemented | Cognito admin-only user creation |
| Privileged access management | Partially implemented | Admin group + MFA operational requirement |
| Access review | Implemented | `docs/operations/access-review-runbook.md` |
| Secure authentication | Implemented | Cognito + PKCE + JWT |
| Password management | Implemented | Cognito password policy |

## A.10 — Cryptography

| Control | Status | Notes |
|---------|--------|-------|
| Encryption controls | Implemented | SSE, TLS, documented in 10.5.15 |
| Key management | Partially implemented | AWS-managed keys only |

## A.12 — Operations security

| Control | Status | Notes |
|---------|--------|-------|
| Logging and monitoring | Implemented | CloudWatch + audit persistence |
| Protection against malware | Not applicable | Managed serverless |
| Backup | Implemented | DynamoDB PITR |
| Event logging | Implemented | Structured audit events |

## A.14 — System acquisition, development and maintenance

| Control | Status | Notes |
|---------|--------|-------|
| Secure development | Partially implemented | CI tests, CodeQL potential |
| Test data | Implemented | Mock provider mode |
| Change control | Implemented | GitHub PR workflow |

## A.16 — Information security incident management

| Control | Status | Notes |
|---------|--------|-------|
| Incident procedures | Implemented | Incident response runbook |
| Evidence collection | Implemented | Runbook section |

## A.17 — Business continuity

| Control | Status | Notes |
|---------|--------|-------|
| Continuity planning | Planned | Formal BCP document |
| Redundancy | Partially implemented | AWS regional services |

## A.18 — Compliance

| Control | Status | Notes |
|---------|--------|-------|
| Legal requirements review | Planned | |
| Privacy | Partially implemented | Email in audit records |

## Summary

ISO 27001 Annex A controls are partially addressed through technical implementation and operational runbooks. Certification would require formal ISMS scope, risk treatment plans, internal audits, and management review processes beyond this sprint.
