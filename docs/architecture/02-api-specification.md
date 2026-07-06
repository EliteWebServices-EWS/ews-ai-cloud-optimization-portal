# API Specification

**Project:** EWS AI Cloud Optimization Platform (SISU'M)

**Version:** 1.0

**Status:** Draft (Sprint 0)

**Depends On:**

- `00-project-philosophy.md`
- `01-architecture-specification.md`

## 1. Purpose

This document defines the official REST API for SISU'M.

It is the contract between:

- Frontend
- Backend
- Future CLI
- Future Mobile Apps
- Future Third-party Integrations

Every endpoint, request, response and status code must follow this specification.

## 2. API Design Principles

The API must be:

- RESTful
- Predictable
- Versioned
- Stateless
- Resource-oriented
- JSON only
- Consistent
- Explainable

## 3. Base URL

**Demo**

```
http://localhost:3000/api/v1
```

**Production**

```
https://api.sisum.ai/v1
```

Every endpoint begins with

```
/api/v1/
```

## 4. API Versioning

**Current Version**

v1

**Future**

v2

Breaking changes require a new API version.

## 5. Response Format

Every response follows the same structure.

**Success**

```json
{
    "success": true,
    "data": {},
    "metadata": {}
}
```

**Failure**

```json
{
    "success": false,
    "error": {
        "code": "PLUGIN_NOT_FOUND",
        "message": "Requested plugin does not exist."
    }
}
```

## 6. Standard Metadata

Every successful response should include:

```json
{
  "metadata": {
    "requestId": "req-001",
    "timestamp": "2026-07-06T12:30:00Z",
    "version": "v1"
  }
}
```

## 7. Resource Model

The API is centered around platform resources.

Resources include:

- Plugins
- Optimization Candidates
- Recommendations
- Evidence
- Workflows
- Verification
- History
- Reports

Not EC2.

EC2 is simply one plugin.

## 8. Endpoint Categories

- Plugins
- Candidates
- Evidence
- Recommendations
- Verification
- Workflows
- Reports
- Health
- Configuration

## 9. Health Endpoints

### `GET /health`

**Purpose**

Verify service availability.

**Response**

```json
{
    "success": true,
    "status": "healthy"
}
```

### `GET /health/providers`

**Returns**

- Mock Provider Status
- AWS Provider Status

### `GET /health/plugins`

**Returns**

Installed plugins.

Example:

```json
{
    "plugins": [
        "ec2"
    ]
}
```

## 10. Plugin Endpoints

### `GET /plugins`

**Returns**

Installed plugins.

Example:

```json
{
    "plugins": [
        "ec2",
        "rds",
        "ebs"
    ]
}
```

### `GET /plugins/{plugin}`

**Returns**

Plugin information.

Example:

```
GET /plugins/ec2
```

### `POST /plugins/{plugin}/discover`

**Purpose**

Discover optimization candidates.

**Response**

```json
{
    "success": true,
    "candidateCount": 15
}
```

### `POST /plugins/{plugin}/analyze`

**Purpose**

Run plugin analysis.

Example:

```
POST /plugins/ec2/analyze
```

## 11. Candidate Endpoints

### `GET /candidates`

Returns all optimization candidates.

Supports:

- filtering
- pagination
- sorting

### `GET /candidates/{id}`

**Returns**

One candidate.

### `POST /candidates/refresh`

Refreshes candidate inventory.

## 12. Evidence Endpoints

### `GET /evidence/{candidateId}`

**Returns**

Evidence collected.

Example:

```json
{
    "cpu": 18,
    "memory": 24,
    "uptime": 210
}
```

### `POST /evidence/collect`

Collect evidence.

**Request**

```json
{
    "plugin": "ec2"
}
```

## 13. Recommendation Endpoints

### `GET /recommendations`

Returns recommendations.

### `GET /recommendations/{id}`

Returns one recommendation.

### `POST /recommendations/generate`

Generate recommendations.

Example:

```json
{
    "plugin": "ec2"
}
```

## 14. Recommendation Response

```json
{
  "candidate": {},
  "evidence": {},
  "readiness": {},
  "confidence": {},
  "governance": {},
  "financialImpact": {},
  "recommendation": {},
  "verificationStatus": {}
}
```

Savings remain one field inside `financialImpact`, reinforcing that SISU'M is a decision platform rather than a cost calculator.

## 15. HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 202 | Accepted |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

## 16. Error Codes

| Code | Description |
|---|---|
| `PLUGIN_NOT_FOUND` | Requested plugin does not exist |
| `PROVIDER_UNAVAILABLE` | Provider is offline |
| `EVIDENCE_INCOMPLETE` | Required evidence missing |
| `GOVERNANCE_BLOCKED` | Recommendation blocked by policy |
| `VERIFICATION_FAILED` | Verification unsuccessful |
| `INVALID_REQUEST` | Request validation failed |

## 17. API Rules

Every endpoint must:

- Return JSON.
- Include a request ID.
- Validate all input.
- Never expose stack traces.
- Return consistent error responses.
- Be fully documented before implementation.

Business logic must remain in the Core Engines, not in the API layer.

## 18. Workflow APIs

### 18.1 Purpose

Workflow APIs control the end-to-end optimization lifecycle:

**Evidence → Qualification → Governance → Financial Analysis → Recommendation → Verification → Learning**

These APIs do NOT perform computation. They trigger orchestration.

### 18.2 `POST /workflows/run`

Start a full optimization workflow.

**Request**

```json
{
  "plugin": "ec2",
  "mode": "full",
  "resourceGroup": "default"
}
```

**Response**

```json
{
  "success": true,
  "data": {
    "workflowId": "wf_12345",
    "status": "running"
  }
}
```

### 18.3 `GET /workflows/{workflowId}`

Fetch workflow state.

**Response**

```json
{
  "workflowId": "wf_12345",
  "status": "completed",
  "currentStage": "verification",
  "stages": [
    "evidence",
    "qualification",
    "governance",
    "financial",
    "recommendation",
    "verification",
    "learning"
  ]
}
```

### 18.4 `GET /workflows`

List workflows.

Supports:

- pagination
- plugin filtering
- status filtering

### 18.5 `POST /workflows/{workflowId}/retry`

Retry failed workflow step.

## 19. Verification APIs

### 19.1 Purpose

Verification confirms whether execution matched expected outcomes.

### 19.2 `GET /verification/{workflowId}`

**Response**

```json
{
  "workflowId": "wf_12345",
  "status": "verified",
  "expectedSavings": 26.60,
  "actualSavings": 25.90,
  "variance": -0.70,
  "confidenceScore": 0.91
}
```

### 19.3 `POST /verification/run`

Manually trigger verification.

**Request**

```json
{
  "workflowId": "wf_12345"
}
```

### 19.4 Verification States

| State | Meaning |
|---|---|
| `pending` | Waiting for data |
| `verified` | Successful match |
| `partial` | Minor variance |
| `failed` | Significant mismatch |

## 20. Reports APIs

### 20.1 Purpose

Reports provide human-readable summaries of optimization activity.

### 20.2 `GET /reports/summary`

Returns high-level platform insights.

**Response**

```json
{
  "totalWorkflows": 120,
  "totalSavings": 4820,
  "verifiedSavings": 4100,
  "topPlugin": "ec2"
}
```

### 20.3 `GET /reports/workflow/{workflowId}`

Detailed workflow report.

**Response**

```json
{
  "workflowId": "wf_12345",
  "plugin": "ec2",
  "summary": "Rightsizing recommendation for 3 instances",
  "financialImpact": {
    "monthlySavings": 26.6
  },
  "verification": {
    "status": "verified"
  }
}
```

### 20.4 `GET /reports/export`

Export report data.

Formats:

- JSON
- CSV (future)

## 21. Configuration APIs

### 21.1 Purpose

Controls system behavior without code changes.

### 21.2 `GET /config`

Returns system configuration.

**Response**

```json
{
  "mode": "demo",
  "provider": "mock",
  "region": "us-east-1",
  "loggingLevel": "info"
}
```

### 21.3 `PUT /config`

Update configuration.

**Request**

```json
{
  "mode": "live",
  "provider": "aws"
}
```

### 21.4 Configuration Rules

- Switching provider must NOT restart system
- Changes must be logged
- Sensitive fields must be validated
- Invalid configs must be rejected

## 22. Mock Data APIs

### 22.1 Purpose

Mock APIs simulate AWS behavior for:

- development
- demos
- testing
- cost-free execution

### 22.2 `GET /mock/resources`

Returns fake cloud resources.

**Response**

```json
[
  {
    "resourceId": "i-mock-001",
    "type": "ec2",
    "cpu": 12,
    "memory": 34
  }
]
```

### 22.3 `GET /mock/metrics`

Simulated CloudWatch metrics.

**Response**

```json
{
  "cpuUtilization": [10, 12, 15, 9],
  "memoryUtilization": [30, 35, 33, 32]
}
```

### 22.4 `POST /mock/reset`

Reset mock dataset.

### 22.5 Mock Rules

- Must behave deterministically
- Must simulate real AWS patterns
- Must be reusable across plugins
- Must NOT leak into production logic

## 23. Provider APIs

### 23.1 Purpose

Provider APIs abstract infrastructure sources.

Core rule:

> The platform never talks to AWS directly.

### 23.2 `GET /providers`

List available providers.

**Response**

```json
{
  "providers": [
    "mock",
    "aws"
  ],
  "active": "mock"
}
```

### 23.3 `POST /providers/switch`

Switch active provider.

**Request**

```json
{
  "provider": "aws"
}
```

### 23.4 `GET /providers/status`

Check provider health.

**Response**

```json
{
  "mock": "healthy",
  "aws": "connected"
}
```

### 23.5 Provider Rules

Providers must:

- normalize AWS responses
- never expose raw SDK responses
- never perform optimization logic
- never calculate financial impact

## 24. System Control APIs

### 24.1 `GET /system/status`

Overall system health.

**Response**

```json
{
  "status": "operational",
  "activeWorkflows": 5,
  "provider": "mock"
}
```

### 24.2 `POST /system/reset`

Reset system state (demo only).

## 25. Cross-Cutting API Rules

### 25.1 Idempotency

All workflow APIs must support idempotent execution.

### 25.2 Rate Limiting

Future enforcement:

| Endpoint Type | Limit |
|---|---|
| workflows | medium |
| reports | high |
| config | low |

### 25.3 Pagination

All list endpoints must support:

- `limit`
- `offset`
- `filters`

### 25.4 Error Standard

```json
{
  "success": false,
  "error": {
    "code": "WORKFLOW_FAILED",
    "message": "Evidence collection failed",
    "stage": "evidence"
  }
}
```

### 25.5 Logging Requirement

Every API call must generate:

- `requestId`
- `workflowId` (if applicable)
- `plugin` (if applicable)
- execution trace

## 26. API Behavioral Contract

The API must enforce:

- ✔ Workflow-driven execution
- ✔ Provider abstraction
- ✔ Deterministic mock mode
- ✔ Stateless requests
- ✔ Engine-based processing
- ✔ No business logic in controllers

## 27. Summary

This part defines the operational backbone of SISU'M:

- Workflow execution APIs
- Verification system APIs
- Reporting layer
- Configuration system
- Mock data system
- Provider abstraction layer
- System control APIs

These APIs ensure that:

The platform can run fully in demo mode with zero AWS cost, and seamlessly switch to production mode without changing application logic.

## 28. Authentication & Authorization

### 28.1 Purpose

Authentication ensures only valid users and systems can access SISU'M APIs.

Authorization ensures users can only perform allowed actions.

### 28.2 Authentication Strategy (MVP → Future)

**MVP (Phase 1)**

- No authentication in Demo Mode
- IP-based restriction optional

**Phase 2 (Production Ready)**

- JWT-based authentication
- Token issued via Identity Provider (Cognito recommended)

**Phase 3 (Enterprise)**

- OAuth2 / SSO integration
- Role-based access control (RBAC)
- Multi-tenant isolation

### 28.3 Authorization Model (RBAC)

| Role | Permissions |
|---|---|
| Admin | Full system access |
| Engineer | Run workflows, view results |
| Analyst | Read-only + reports |
| Viewer | Limited dashboards |

### 28.4 Authorization Rule Example

```json
{
  "role": "Engineer",
  "permissions": [
    "workflow:run",
    "workflow:view",
    "recommendation:view"
  ]
}
```

## 29. Input Validation Layer

### 29.1 Purpose

All API inputs must be validated BEFORE reaching engines or plugins.

### 29.2 Validation Rules

- All requests must define schema
- Invalid requests must fail fast
- No partial execution allowed

### 29.3 Example Schema (Zod-style)

```javascript
const RunWorkflowSchema = {
  plugin: "string",
  mode: "enum(full|dry-run)",
  resourceGroup: "string"
}
```

### 29.4 Validation Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "plugin is required"
  }
}
```

## 30. Event System Architecture

### 30.1 Purpose

Events decouple systems and enable async workflows.

### 30.2 Event Flow

```
API → EventBus → Orchestrator → Engines → Plugins → Storage
```

### 30.3 Core Events

| Event | Description |
|---|---|
| `workflow.started` | Workflow initiated |
| `evidence.collected` | Evidence ready |
| `recommendation.generated` | Recommendation created |
| `governance.approved` | Approved |
| `execution.completed` | Execution finished |
| `verification.done` | Verification complete |
| `learning.updated` | Data stored |

### 30.4 Event Structure

```json
{
  "eventType": "workflow.started",
  "workflowId": "wf_123",
  "timestamp": "2026-07-06T12:00:00Z",
  "payload": {}
}
```

### 30.5 Event Rules

- Events must be immutable
- Events must be append-only
- Events must be traceable by `workflowId`
- Events must not contain secrets

## 31. Webhooks System

### 31.1 Purpose

Webhooks notify external systems of key events.

### 31.2 Supported Webhooks

| Event | Trigger |
|---|---|
| `workflow.completed` | Workflow finished |
| `recommendation.ready` | Recommendation generated |
| `verification.failed` | Verification mismatch |

### 31.3 Webhook Payload

```json
{
  "event": "workflow.completed",
  "workflowId": "wf_123",
  "status": "success",
  "timestamp": "2026-07-06T12:00:00Z"
}
```

### 31.4 Retry Policy

- Retry up to 3 times
- Exponential backoff
- Dead-letter queue for failures

## 32. Rate Limiting

### 32.1 Purpose

Prevent system overload and ensure fairness.

### 32.2 Limits

| Endpoint | Limit |
|---|---|
| `/workflows/run` | 10/min |
| `/recommendations` | 30/min |
| `/reports` | 100/min |
| `/config` | 5/min |

### 32.3 Response on Limit Exceeded

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests"
  }
}
```

## 33. Idempotency

### 33.1 Purpose

Prevent duplicate workflow execution.

### 33.2 Idempotency Key

Required for:

- `workflow/run`
- `recommendations/generate`

### 33.3 Example Header

```
Idempotency-Key: wf_12345
```

## 34. OpenAPI Specification Strategy

### 34.1 Purpose

Provide machine-readable API documentation.

### 34.2 Format

- OpenAPI 3.0
- JSON or YAML
- Auto-generated from API code

### 34.3 Core Sections

- `paths`
- `schemas`
- `responses`
- `security`
- `tags`

### 34.4 Example OpenAPI Entry

```yaml
/workflows/run:
  post:
    summary: Run optimization workflow
    responses:
      200:
        description: Workflow started
```

## 35. API Lifecycle Policy

### 35.1 Stages

| Stage | Meaning |
|---|---|
| `alpha` | internal testing |
| `beta` | early users |
| `stable` | production |
| `deprecated` | scheduled removal |

### 35.2 Deprecation Rule

- Minimum 90-day notice
- Backward compatibility maintained
- Header warning required

## 36. Versioning Strategy

### 36.1 Rules

- Breaking change = new version
- Non-breaking change = same version
- Deprecated endpoints remain until migration complete

### 36.2 Example

- v1 → stable
- v2 → future evolution

## 37. API Governance Rules

### 37.1 Mandatory Rules

- No business logic in API layer
- All computation in engines/plugins
- All AWS calls through providers
- All workflows must be traceable
- All responses must be structured

### 37.2 Forbidden Patterns

- ❌ Direct AWS SDK calls in API
- ❌ Inline financial calculations
- ❌ Hardcoded plugin logic
- ❌ Unstructured responses
- ❌ Silent failures

## 38. Security Rules

### 38.1 Data Protection

- No secrets in logs
- No credentials in responses
- Encrypt sensitive fields
- Use least privilege IAM

### 38.2 Transport Security

- HTTPS only in production
- TLS 1.2+

### 38.3 Input Safety

- Validate all inputs
- Reject unknown fields
- Sanitize all payloads

## 39. Observability Requirements

Every request must generate:

- `requestId`
- `workflowId` (if exists)
- `plugin` (if exists)
- execution trace
- latency metrics

## 40. Error Handling Standard

### 40.1 Format

```json
{
  "success": false,
  "error": {
    "code": "ENGINE_FAILURE",
    "message": "Evidence engine failed",
    "stage": "evidence"
  }
}
```

### 40.2 Error Categories

| Category | Meaning |
|---|---|
| `VALIDATION_ERROR` | Bad input |
| `AUTH_ERROR` | Unauthorized |
| `PROVIDER_ERROR` | AWS/mock failure |
| `ENGINE_ERROR` | Core failure |
| `PLUGIN_ERROR` | Plugin failure |

## 41. API Design Principles (Final Enforcement Layer)

The API must always:

- ✔ Be stateless
- ✔ Be deterministic
- ✔ Be traceable
- ✔ Be versioned
- ✔ Be modular
- ✔ Separate concerns
- ✔ Avoid business logic
- ✔ Support mock mode
- ✔ Support live mode

## 42. Final API Architecture Summary

SISU'M API is designed as:

> A workflow orchestration API layer that connects users to a modular decision engine system.

It does NOT:

- calculate savings
- directly query AWS
- implement optimization logic

It ONLY:

- triggers workflows
- routes requests
- enforces contracts
- returns structured results

## 43. Final Statement

This API specification ensures that SISU'M can:

- scale from MVP → enterprise
- support multi-cloud providers
- plug in new optimization domains (EC2 → Kubernetes → Azure)
- remain cost-efficient
- maintain strict separation of concerns
- evolve without breaking existing clients
