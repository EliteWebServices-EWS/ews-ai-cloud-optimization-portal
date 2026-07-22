# ADR 041 — DynamoDB Durable Multi-Tenant Persistence

## Status

Proposed for Sprint 11.

## Purpose

Sprint 11 replaces the current in-memory business-data stores with durable DynamoDB storage.

This persistence foundation covers:

1. Workflows
2. Reports
3. Learning records
4. Verification records
5. Ownership records

This work creates only the database and repository foundation. It does not change workflow, reporting, learning, or verification business logic.

## Tenant Isolation Rule

The tenant ID must come from the authenticated server request context.

The tenant ID must never come from:

- A browser-provided header
- A URL parameter
- A request-body field
- An unauthenticated client value

Tenant-owned records use this partition-key pattern:

```text
pk = TENANT#<tenantId>
```

## Common Key Design

Tenant-owned records use:

```text
pk = TENANT#<tenantId>
sk = <RESOURCE_TYPE>#<resourceId>
```

Example workflow:

```text
pk = TENANT#sisum-default
sk = WORKFLOW#wf-123
```

Example report:

```text
pk = TENANT#sisum-default
sk = REPORT#report-123
```

The physical attribute names will be lowercase:

```text
pk
sk
```

This matches the existing DynamoDB audit-table convention.

---

## 1. Workflow Table

Table name:

```text
sisum-workflows-<environment>
```

Primary key:

```text
pk = TENANT#<tenantId>
sk = WORKFLOW#<workflowId>
```

Example item:

```json
{
  "pk": "TENANT#sisum-default",
  "sk": "WORKFLOW#wf-123",
  "entityType": "WORKFLOW",
  "tenantId": "sisum-default",
  "workflowId": "wf-123",
  "status": "PENDING",
  "version": 1,
  "createdAt": "2026-07-22T10:00:00.000Z",
  "updatedAt": "2026-07-22T10:00:00.000Z",
  "gsi1pk": "TENANT#sisum-default#WORKFLOW_STATUS#PENDING",
  "gsi1sk": "CREATED_AT#2026-07-22T10:00:00.000Z#WORKFLOW#wf-123"
}
```

Supported access patterns:

- Create a workflow
- Get a workflow by tenant ID and workflow ID
- Update a workflow
- Delete a workflow
- List workflows belonging to a tenant
- List workflows by status
- Paginate workflow results

The workflow status GSI uses:

```text
gsi1pk = TENANT#<tenantId>#WORKFLOW_STATUS#<status>
gsi1sk = CREATED_AT#<createdAt>#WORKFLOW#<workflowId>
```

---

## 2. Report Table

Table name:

```text
sisum-reports-<environment>
```

Primary key:

```text
pk = TENANT#<tenantId>
sk = REPORT#<reportId>
```

Example item:

```json
{
  "pk": "TENANT#sisum-default",
  "sk": "REPORT#report-123",
  "entityType": "REPORT",
  "tenantId": "sisum-default",
  "reportId": "report-123",
  "workflowId": "wf-123",
  "status": "COMPLETED",
  "version": 1,
  "createdAt": "2026-07-22T10:00:00.000Z",
  "updatedAt": "2026-07-22T10:00:00.000Z",
  "gsi1pk": "TENANT#sisum-default#WORKFLOW#wf-123",
  "gsi1sk": "CREATED_AT#2026-07-22T10:00:00.000Z#REPORT#report-123"
}
```

Supported access patterns:

- Create a report
- Get a report by tenant ID and report ID
- Update a report
- Delete a report
- List reports belonging to a tenant
- List reports belonging to a workflow
- Paginate report results

---

## 3. Learning Table

Table name:

```text
sisum-learning-<environment>
```

Primary key:

```text
pk = TENANT#<tenantId>
sk = LEARNING#<learningId>
```

Example item:

```json
{
  "pk": "TENANT#sisum-default",
  "sk": "LEARNING#learning-123",
  "entityType": "LEARNING",
  "tenantId": "sisum-default",
  "learningId": "learning-123",
  "workflowId": "wf-123",
  "feedbackType": "ACCEPTED",
  "version": 1,
  "createdAt": "2026-07-22T10:00:00.000Z",
  "updatedAt": "2026-07-22T10:00:00.000Z",
  "gsi1pk": "TENANT#sisum-default#WORKFLOW#wf-123",
  "gsi1sk": "CREATED_AT#2026-07-22T10:00:00.000Z#LEARNING#learning-123"
}
```

Supported access patterns:

- Create a learning record
- Get a learning record
- Update a learning record
- Delete a learning record
- List learning records belonging to a tenant
- List learning records belonging to a workflow
- Paginate learning results

---

## 4. Verification Table

Table name:

```text
sisum-verifications-<environment>
```

Primary key:

```text
pk = TENANT#<tenantId>
sk = VERIFICATION#<verificationId>
```

Example item:

```json
{
  "pk": "TENANT#sisum-default",
  "sk": "VERIFICATION#verification-123",
  "entityType": "VERIFICATION",
  "tenantId": "sisum-default",
  "verificationId": "verification-123",
  "workflowId": "wf-123",
  "outcome": "PASSED",
  "version": 1,
  "createdAt": "2026-07-22T10:00:00.000Z",
  "updatedAt": "2026-07-22T10:00:00.000Z",
  "gsi1pk": "TENANT#sisum-default#WORKFLOW#wf-123",
  "gsi1sk": "CREATED_AT#2026-07-22T10:00:00.000Z#VERIFICATION#verification-123"
}
```

Supported access patterns:

- Create a verification record
- Get a verification record
- Update a verification record
- Delete a verification record
- List verification records belonging to a tenant
- List verification records belonging to a workflow
- Paginate verification results

---

## 5. Ownership Table

Table name:

```text
sisum-ownership-<environment>
```

The ownership table supports secure cross-tenant resource checks.

Primary key:

```text
pk = RESOURCE#<resourceType>#<resourceId>
sk = OWNERSHIP
```

Example item:

```json
{
  "pk": "RESOURCE#WORKFLOW#wf-123",
  "sk": "OWNERSHIP",
  "entityType": "OWNERSHIP",
  "resourceType": "WORKFLOW",
  "resourceId": "wf-123",
  "ownerTenantId": "sisum-default",
  "version": 1,
  "createdAt": "2026-07-22T10:00:00.000Z",
  "updatedAt": "2026-07-22T10:00:00.000Z"
}
```

The ownership table must never expose `ownerTenantId` to an unauthorized API client.

Cross-tenant requests must continue returning:

```text
HTTP 404 Not Found
```

---

## Billing and Scaling

All five Sprint 11 tables use:

```text
BillingMode = PAY_PER_REQUEST
```

This provides automatic on-demand capacity scaling.

Provisioned-capacity Application Auto Scaling is not configured because it cannot be combined with `PAY_PER_REQUEST`.

---

## Encryption

Every table must enable DynamoDB server-side encryption.

CloudFormation configuration:

```yaml
SSESpecification:
  SSEEnabled: true
```

---

## Point-in-Time Recovery

Every table must enable point-in-time recovery.

CloudFormation configuration:

```yaml
PointInTimeRecoverySpecification:
  PointInTimeRecoveryEnabled: true
```

---

## Time to Live

Every table will configure the TTL attribute:

```text
expiresAt
```

`expiresAt` is stored as Unix epoch time in seconds.

Permanent records may omit `expiresAt`.

CloudFormation configuration:

```yaml
TimeToLiveSpecification:
  AttributeName: expiresAt
  Enabled: true
```

---

## Conditional Creation

Create operations must use:

```text
attribute_not_exists(pk) AND attribute_not_exists(sk)
```

This prevents an existing record from being overwritten accidentally.

---

## Version Numbers

Every mutable record starts with:

```text
version = 1
```

A successful update increments the version:

```text
version = version + 1
```

---

## Optimistic Locking

Update operations must receive an expected version.

Example:

```text
expectedVersion = 2
```

The DynamoDB condition is:

```text
version = expectedVersion
```

If another request already updated the record, DynamoDB rejects the stale update.

---

## Pagination

List operations use DynamoDB `Query`.

The repository accepts:

```text
limit
nextToken
```

DynamoDB returns:

```text
LastEvaluatedKey
```

The repository encodes `LastEvaluatedKey` into an opaque:

```text
nextToken
```

Clients must return the token unchanged when requesting the next page.

---

## Query Rules

Allowed operations include:

- `GetItem`
- `PutItem`
- `UpdateItem`
- `DeleteItem`
- `Query`
- `TransactGetItems`
- `TransactWriteItems`

The following operation is prohibited:

```text
Scan
```

Repository list methods must use `Query`, not `Scan`.

---

## IAM Rules

The Lambda runtime policy must:

- Reference only the five approved tables
- Include GSI ARNs where indexes are queried
- Permit only required DynamoDB actions
- Exclude `dynamodb:Scan`
- Exclude `dynamodb:*`

---

## CloudFormation Retention

All business-data tables must use:

```yaml
DeletionPolicy: Retain
UpdateReplacePolicy: Retain
```

This reduces the risk of accidental data loss during stack deletion or table replacement.

---

## Repository Boundary

Repository contracts are placed under:

```text
backend/repositories/contracts/
```

DynamoDB implementations are placed under:

```text
backend/repositories/dynamodb/
```

Database utilities are placed under:

```text
backend/database/
```

Repository interfaces contain no workflow, reporting, learning, verification, financial, governance, or recommendation business logic.

---

## Prohibited Operations

- DynamoDB Scan
- Cross-tenant partition queries
- Browser-controlled tenant keys
- Unconditional replacement of versioned records
- Returning another tenant's identity to a client
- Logging complete sensitive records
- Wildcard `dynamodb:*` runtime permissions
- Adding business logic to repository contracts

---

## Decision Outcome

Sprint 11 establishes durable, tenant-aware DynamoDB persistence that survives Lambda cold starts and supports concurrent Lambda execution.

The repository contracts allow other engineers to integrate workflow, reporting, learning, and verification business logic without depending directly on DynamoDB SDK details.