# Sprint 13 — Live AWS integration architecture

**Sprint:** Live AWS Account Integration & Evidence Collection Foundation
**Status:** Implemented on `main`; production validated (see [production validation report](../validation/sprint-13-production-validation-report.md))

This document complements [aws-account-discovery.md](./aws-account-discovery.md) and [aws-integration-validation-readiness.md](../validation/aws-integration-validation-readiness.md).

---

## Boundaries and responsibilities

| Party | Responsibility |
|-------|----------------|
| Customer | IAM role, trust policy (External ID + platform principal), read policy scope |
| Platform | Tenant registry, membership RBAC, STS AssumeRole, verification/discovery, sanitized persistence |
| AWS | STS, IAM enforcement, service APIs |

**Never persisted by the platform:** customer access keys, session tokens, MFA codes, Authorization headers, full External ID in client-visible API payloads (stored server-side only; responses redacted).

**Persisted (sanitized):** account IDs, regions, verification/discovery status, capability summaries, warnings, timestamps, version, audit metadata.

---

## A. Tenant onboarding and first-owner flow

```mermaid
sequenceDiagram
  participant PA as Platform Admin
  participant API as API Gateway + Lambda
  participant Reg as Tenant Registry
  participant Cognito as Cognito User Pool
  participant Owner as Tenant Owner (future)

  PA->>API: POST /api/v1/admin/tenants
  API->>Reg: Create tenant PROVISIONING
  API->>Cognito: AdminUpdateUserAttributes custom:tenantId
  Cognito-->>API: OK
  API->>Reg: Transition ACTIVE
  API-->>PA: tenant + reauthenticationRequired true

  Owner->>Cognito: Sign out / sign in
  Cognito-->>Owner: JWT tenant_id matches registry

  PA->>API: POST /api/v1/tenants/bootstrap-owner (MFA)
  API->>Reg: TransactWrite OWNER_BOOTSTRAP + tenant_owner membership
  API-->>PA: membership ACTIVE version 1
```

Notes:

- Bootstrap is **one-time**; second call returns **409**.
- Bootstrap requires **platform admin** + **privileged MFA**.
- Tenant must be **ACTIVE** before bootstrap.

---

## B. AWS account onboarding flow

```mermaid
sequenceDiagram
  participant TO as Tenant Owner/Admin
  participant API as API Gateway + Lambda
  participant DDB as DynamoDB AWS Accounts
  participant Cust as Customer IAM
  participant STS as AWS STS

  TO->>API: POST /api/v1/aws-accounts
  API->>DDB: Register account PENDING, generate External ID
  API-->>TO: accountId region redacted externalIdRef

  TO->>Cust: Create SisumReadOnlyIntegrationRole trust + read policy
  Note over Cust: Trust platform SisumLambdaExecutionRole + External ID

  TO->>API: POST /api/v1/aws-accounts/:id/verify expectedVersion
  API->>STS: AssumeRole + External ID
  STS->>Cust: Temporary credentials
  API->>Cust: Required read probes
  API->>DDB: VERIFIED SUCCEEDED version++
  API-->>TO: HTTP 200 verification summary
```

---

## C. Discovery flow

```mermaid
sequenceDiagram
  participant Client as Authenticated Client
  participant GW as API Gateway JWT Authorizer
  participant Lam as Lambda
  participant RBAC as Membership RBAC
  participant Svc as AwsAccountApiService
  participant STS as StsCredentialProvider
  participant AWS as Customer Account APIs
  participant DDB as DynamoDB

  Client->>GW: POST /api/v1/aws-accounts/:accountId/discovery
  GW->>Lam: JWT claims mapped to trusted identity
  Lam->>RBAC: Tenant-scoped role check
  RBAC-->>Lam: Allow
  Lam->>Svc: runDiscovery
  Svc->>STS: AssumeRole
  STS->>AWS: GetCallerIdentity DescribeRegions probes
  AWS-->>Svc: Results + optional warnings
  Svc->>Svc: Sanitize metadata
  Svc->>DDB: Optimistic-lock update version++
  Lam->>Lam: Audit event
  Lam-->>Client: HTTP 200 discovery payload
```

**Identity safety:** GetCallerIdentity account ID must match registered `accountId`. Mismatch fails safely and must not incorrectly mark the account VERIFIED.

**HTTP method:** Discovery is **`POST`**, not GET.

---

## D. Trust relationship

```mermaid
flowchart LR
  subgraph Platform["Platform account 739275446782"]
    LER["SisumLambdaExecutionRole"]
  end
  subgraph Customer["Customer account 572262081497"]
    IRR["SisumReadOnlyIntegrationRole"]
  end
  LER -->|"sts:AssumeRole + ExternalId"| IRR
  IRR --> RO["Read-only API calls"]
```

- Platform Lambda assumes **customer role**; customer does not hold platform credentials.
- External ID mitigates confused deputy when multiple customers use similar role names.
- Validation evidence used managed read-only breadth; **production customers should use a narrower policy** (see [security validation](../security/sprint-13-security-validation.md)).

---

## Component map

| Layer | Components |
|-------|------------|
| HTTP | `aws-account.routes.ts`, `tenant-bootstrap.routes.ts`, `tenant-admin.routes.ts` |
| Domain | `aws-account-api-service.ts`, discovery in `execution/adapters/sts/` |
| Credentials | STS adapter, in-memory cache keyed by tenant + role |
| Data | `dynamodb-aws-account-repository.ts`, membership repositories |
| Auth | `privileged-mfa.ts`, trusted identity in `lambda.ts` |

---

## Related documentation

- [Sprint 13 closeout](../handoff/sprint-13-closeout.md)
- [Operations runbook](../operations/sprint-13-live-aws-integration-runbook.md)
- [Tenant onboarding runbook](../operations/tenant-onboarding-runbook.md) (if present — align steps with #190)
