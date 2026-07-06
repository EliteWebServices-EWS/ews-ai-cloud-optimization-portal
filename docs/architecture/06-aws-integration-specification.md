# AWS Integration Specification

**Project:** SISU'M Cloud Optimization Decision Platform

**Version:** 1.0

**Status:** Sprint 0 Foundation Document

---

# 1. Purpose

This document defines how SISU'M integrates with AWS services.

Its goals are to:

* Standardize all AWS integrations
* Minimize AWS costs
* Keep the platform cloud-agnostic
* Support Mock Mode and Live Mode
* Prevent AWS SDK usage outside the Provider Layer

This document is mandatory for all engineers.

---

# 2. Integration Philosophy

AWS is an infrastructure provider.

It is **not** part of the business logic.

Therefore:

```text
API
    ↓
Orchestrator
    ↓
Core Engines
    ↓
Plugins
    ↓
Provider Interface
    ↓
AWS Provider
    ↓
AWS Services
```

Business logic must never know which cloud provider is being used.

---

# 3. Integration Principles

Every AWS integration must satisfy these principles:

✔ Provider abstraction

✔ Least privilege IAM

✔ Cost efficiency

✔ Retry safety

✔ Idempotency

✔ Observable execution

✔ Mock compatibility

---

# 4. Repository Structure

```text
backend/

src/

providers/

provider.interface.ts

factory.ts

aws/

aws.provider.ts

clients/

cloudwatch.client.ts

ec2.client.ts

rds.client.ts

pricing.client.ts

compute-optimizer.client.ts

mock/

mock.provider.ts
```

Only the Provider Layer communicates with AWS SDK v3.

---

# 5. Provider Interface

Every provider must implement the same contract.

```typescript
export interface CloudProvider {

getEC2Instances()

getCloudWatchMetrics()

getRecommendations()

getPricing()

getRDSInstances()

getEBSVolumes()

getS3Buckets()

}
```

Future providers:

* AWS
* Azure
* GCP
* Mock

must implement the same interface.

---

# 6. Supported AWS Services (MVP)

| AWS Service       | Purpose                        |
| ----------------- | ------------------------------ |
| EC2               | Resource inventory             |
| CloudWatch        | Performance metrics            |
| Compute Optimizer | Optimization recommendations   |
| Pricing API       | Cost estimation                |
| DynamoDB          | Hot operational data           |
| S3                | Evidence and reports           |
| Lambda            | Compute                        |
| Step Functions    | Workflow orchestration         |
| EventBridge       | Scheduling and events          |
| IAM               | Authentication and permissions |

---

# 7. AWS Services (Future)

Not required for MVP.

* EKS
* Cost Explorer
* Trusted Advisor
* Organizations
* Bedrock
* SageMaker
* CloudTrail
* Security Hub

These remain on the roadmap until customer demand exists.

---

# 8. Authentication

The AWS Provider must use IAM Roles.

Never use:

* Access keys in source code
* Hard-coded credentials
* Shared administrator credentials

Development environments may use local AWS profiles.

Production must use IAM Roles.

---

# 9. IAM Policy Principles

Permissions must follow least privilege.

Example:

```text
Allow:

DescribeInstances

GetMetricData

GetMetricStatistics

DescribeVolumes

DescribeDBInstances

GetProducts (Pricing API)

ListBuckets

GetObject

PutObject
```

Never grant:

* AdministratorAccess
* FullAccess policies unless absolutely required

---

# 10. Compute Optimizer Integration

Purpose:

Generate optimization candidates.

Provider method:

```typescript
provider.getRecommendations()
```

Returns normalized recommendations.

Plugins consume normalized data.

Plugins never call Compute Optimizer directly.

---

# 11. CloudWatch Integration

Purpose:

Collect telemetry.

Examples:

* CPU utilization
* Network throughput
* Disk I/O
* Memory (when available)

Provider method:

```typescript
provider.getCloudWatchMetrics()
```

Raw CloudWatch responses must be normalized before leaving the Provider Layer.

---

# 12. EC2 Integration

Provider responsibilities:

* Describe instances
* Retrieve metadata
* Retrieve tags
* Retrieve instance type

Returned object must use SISU'M internal models.

---

# 13. RDS Integration

Provider responsibilities:

* Describe DB instances
* Engine type
* Instance class
* Storage allocation

Plugins determine optimization logic.

---

# 14. EBS Integration

Provider responsibilities:

* Describe volumes
* Volume type
* Size
* Attachment status
* Provisioned IOPS

No optimization logic belongs here.

---

# 15. S3 Integration

Provider responsibilities:

* List buckets
* Retrieve storage metrics
* Retrieve lifecycle configuration

Raw object metadata must remain outside business logic.

---

# 16. Pricing API Integration

Purpose:

Support the Financial Engine.

Provider responsibilities:

* Retrieve pricing
* Normalize currency
* Cache responses
* Handle regional pricing

Pricing calculations belong exclusively to the Financial Engine.

---

# 17. EventBridge Integration

Purpose:

Schedule recurring workflows.

Examples:

* Daily optimization scans
* Weekly reports
* Verification jobs

The Provider only triggers schedules.

Workflow logic remains inside the Orchestrator.

---

# 18. Step Functions Integration

Purpose:

Coordinate workflow execution.

Typical flow:

```text
Collect Evidence

↓

Plugin Analysis

↓

Governance

↓

Financial

↓

Verification

↓

Learning
```

Step Functions execute orchestration.

Business decisions remain in the Engines.

---

# 19. Lambda Integration

Lambda hosts:

* API handlers
* Workflow execution
* Scheduled jobs

Lambda functions should remain thin.

They invoke the Orchestrator rather than implementing business logic.

---

# 20. DynamoDB Integration

Provider responsibilities:

* Store workflow state
* Store recommendations
* Store summaries

Database schema is defined in:

`03-database-design.md`

---

# 21. S3 Integration

Store:

* Raw evidence
* Historical reports
* Audit artifacts
* Verification snapshots

Never store transient workflow state in S3.

---

# 22. Mock Provider

Every AWS method must have an equivalent mock implementation.

Example:

```typescript
awsProvider.getEC2Instances()

mockProvider.getEC2Instances()
```

Both return identical object structures.

The rest of the platform should not know which provider is active.

---

# 23. Provider Factory

Provider selection must occur in one location.

Example:

```typescript
ProviderFactory.create()

↓

AWS Provider

or

Mock Provider
```

No conditional provider logic should appear elsewhere.

---

# 24. Error Handling

Provider errors must be normalized.

Example:

```typescript
ProviderError {

code

service

operation

message

retryable

}
```

Engines must never receive raw AWS SDK exceptions.

---

# 25. Retry Policy

Retry only for transient failures.

Examples:

* Throttling
* Temporary service unavailable
* Network timeout

Never retry:

* Access denied
* Invalid request
* Resource not found

---

# 26. Caching Strategy

Cache:

* Pricing
* Static metadata
* Region information

Do not cache:

* Workflow state
* Verification results
* Live telemetry beyond acceptable freshness windows

---

# 27. Observability

Every AWS call must record:

* Service
* Operation
* Duration
* Retry count
* Request ID
* Workflow ID (if applicable)

These metrics support monitoring and troubleshooting.

---

# 28. Cost Optimization Rules

The platform must minimize AWS costs by:

* Batching requests
* Reusing cached data
* Avoiding duplicate API calls
* Preferring scheduled collection over constant polling
* Using Mock Mode during development
* Running verification only when required

---

# 29. Security Rules

Never:

* Log AWS credentials
* Return raw AWS responses
* Expose account IDs unnecessarily
* Store secrets in source code

Secrets must be stored using AWS Secrets Manager or environment variables managed securely.

---

# 30. Future Multi-Cloud Strategy

The Provider Interface enables future providers:

```text
Provider Interface

↓

AWS Provider

Azure Provider

Google Cloud Provider

Mock Provider
```

The Core Platform remains unchanged.

Only new providers are added.

---

# 31. AWS Integration Lifecycle

Every interaction follows the same flow:

```text
Core Engine

↓

Provider Interface

↓

AWS Provider

↓

AWS SDK v3

↓

AWS Service

↓

Normalized Response

↓

Core Engine
```

This guarantees clean separation of concerns.

---

# 32. Definition of Done

An AWS integration is complete when:

* Provider method implemented
* Normalized response returned
* Unit tests written
* Mock implementation available
* IAM permissions documented
* Retry logic implemented
* Logging added
* Cost impact reviewed

---

# 33. Summary

AWS provides infrastructure.

The Provider Layer translates infrastructure into standardized platform data.

Core Engines make decisions.

Plugins implement optimization strategies.

The Orchestrator coordinates execution.

This separation allows SISU'M to:

* Support multiple cloud providers
* Operate in Mock Mode or Live Mode
* Minimize AWS costs
* Scale without architectural changes

---

# Final Statement

AWS is a dependency—not the architecture.

The architecture belongs to SISU'M.

Every AWS integration must strengthen that separation, ensuring the platform remains modular, portable, testable, and ready for future expansion across cloud providers.
