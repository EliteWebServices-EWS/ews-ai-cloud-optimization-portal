# Plugin Specification

**Project:** SISU'M Cloud Optimization Platform

**Version:** 1.0

**Type:** Core Engineering Contract

## 1. Purpose

This document defines how all optimization plugins must be built.

Plugins are the only extensible part of SISU'M.

Everything else in the system is permanent:

- Core Engines (Evidence, Governance, Financial, Verification)
- Orchestrator
- Provider Layer
- API Layer

Plugins are replaceable modules that define how a specific cloud resource is optimized.

## 2. Plugin Philosophy

A plugin is **NOT**:

- a microservice
- a standalone system
- a business logic layer
- a data store
- an AWS integration layer

A plugin **IS**:

> A deterministic optimization strategy module that plugs into the Core Engine system.

## 3. Supported Plugins (Initial Scope)

| Plugin | Purpose |
|---|---|
| EC2 | Compute optimization |
| RDS | Database optimization |
| EBS | Storage volume optimization |
| S3 | Storage lifecycle optimization |
| Kubernetes (EKS) | Cluster optimization |
| Lambda | Serverless optimization |

## 4. Plugin Architecture Contract

Every plugin MUST implement the following interface:

```typescript
interface OptimizationPlugin {
  collectCandidates(): Candidate[]
  collectEvidence(candidate: Candidate): Evidence
  qualify(evidence: Evidence): QualificationResult
  scoreReadiness(evidence: Evidence): number
  scoreConfidence(evidence: Evidence): number
  generateRecommendation(evidence: Evidence): Recommendation
  estimateFinancialImpact(recommendation: Recommendation): FinancialImpact
  verify(executionResult: ExecutionResult): VerificationResult
}
```

## 5. Plugin Lifecycle

Every plugin follows this lifecycle:

```
Candidate
   ↓
Evidence Collection
   ↓
Qualification
   ↓
Readiness Scoring
   ↓
Confidence Scoring
   ↓
Recommendation Generation
   ↓
Financial Estimation
   ↓
Governance Decision (Core Engine)
   ↓
Execution (External)
   ↓
Verification
   ↓
Learning (Core Engine)
```

Plugins stop at:

**Recommendation + Financial Estimation**

Everything after that is handled by Core Engines.

## 6. Plugin Structure (Repository Layout)

Each plugin must follow this structure:

```
plugins/
   ec2/
      index.ts
      collector.ts
      evidence.ts
      rules.ts
      scorer.ts
      estimator.ts
      mapper.ts
      types.ts
```

## 7. Plugin Responsibilities

### 7.1 `collectCandidates()`

Find resources eligible for optimization.

Example (EC2):

- Underutilized instances
- Idle instances
- Oversized instances

### 7.2 `collectEvidence()`

Gather raw signals:

- CPU utilization
- Memory utilization
- Network usage
- Cost data
- Instance metadata

### 7.3 `qualify()`

Determine if resource is valid for analysis.

Rules:

- Must have sufficient metrics
- Must meet minimum observation window
- Must not be blacklisted

### 7.4 `scoreReadiness()`

Measures:

> Can we evaluate this safely?

Includes:

- telemetry completeness
- monitoring quality
- data freshness

Output:

- 0 → 1 score

### 7.5 `scoreConfidence()`

Measures:

> Should we trust this recommendation?

Includes:

- workload stability
- historical consistency
- volatility

Output:

- 0 → 1 score

### 7.6 `generateRecommendation()`

Produces optimization decision:

Example:

```json
{
  "action": "downsize",
  "target": "t3.medium",
  "reason": "Low CPU utilization over 14 days"
}
```

### 7.7 `estimateFinancialImpact()`

Calculates:

- current cost
- projected cost
- savings
- ROI

**IMPORTANT:**

This must NOT modify state. It is purely analytical.

### 7.8 `verify()`

Compares:

- expected outcome
- actual outcome

Returns:

- success
- variance
- confidence adjustment

## 8. Plugin Input Standardization

All plugins must accept standardized inputs:

```json
{
  "resourceId": "i-12345",
  "resourceType": "ec2",
  "region": "us-east-1",
  "tags": {},
  "metrics": {}
}
```

## 9. Plugin Output Standardization

All plugins must return:

```json
{
  "candidate": {},
  "evidence": {},
  "readiness": 0.0,
  "confidence": 0.0,
  "recommendation": {},
  "financialImpact": {}
}
```

## 10. Plugin Isolation Rules

Plugins MUST:

- ✔ Be stateless
- ✔ Be deterministic
- ✔ Be independently testable
- ✔ Not call other plugins
- ✔ Not call Core APIs directly
- ✔ Not access AWS SDK directly (must use Provider Layer)

## 11. Plugin Dependencies

**Allowed dependencies:**

- Provider Layer
- Utility libraries
- Core type definitions

**NOT allowed:**

- Direct DynamoDB access
- Direct workflow orchestration
- Cross-plugin communication
- Business logic from Core Engines

## 12. EC2 Plugin Specification (Reference Implementation)

### Responsibilities

- Identify underutilized EC2 instances
- Evaluate CPU/memory usage
- Recommend instance resizing

### Candidate Logic

```
CPU < 20% over 14 days
AND
No autoscaling dependency
```

### Recommendation Example

```json
{
  "action": "resize",
  "from": "t3.large",
  "to": "t3.medium",
  "reason": "Sustained low utilization"
}
```

## 13. RDS Plugin Specification

### Responsibilities

- Identify oversized DB instances
- Detect idle databases
- Recommend scaling or pause strategies

## 14. EBS Plugin Specification

### Responsibilities

- Detect underutilized volumes
- Recommend gp2 → gp3 migration
- Identify unattached volumes

## 15. S3 Plugin Specification

### Responsibilities

- Identify unused storage
- Recommend lifecycle policies
- Detect cold data

## 16. Kubernetes Plugin Specification

### Responsibilities

- Detect overprovisioned pods
- Recommend node scaling
- Identify idle workloads
- Optimize cluster cost efficiency

## 17. Plugin Deployment Model

Plugins are:

- deployed as part of backend service
- loaded dynamically by Orchestrator
- version-controlled in repository

## 18. Plugin Versioning

```
ec2@1.0.0
rds@1.0.0
ebs@1.0.0
```

Breaking changes require version bump.

## 19. Plugin Testing Requirements

Each plugin must include:

- unit tests
- mock provider tests
- deterministic outputs
- replayable workflows

## 20. Plugin Cost Constraints

Plugins must:

- ✔ Minimize AWS API calls
- ✔ Use cached evidence where possible
- ✔ Avoid duplicate metric fetching
- ✔ Batch resource evaluation

## 21. Plugin Safety Rules

Plugins must **NEVER**:

- execute changes in AWS
- modify infrastructure
- trigger deployments
- approve governance decisions

## 22. Plugin Evaluation Pipeline

```
Provider → Evidence → Plugin → Core Engines → Recommendation
```

Plugins are only ONE stage in the system.

## 23. Plugin Extensibility Rule

To add a new optimization domain, you **ONLY**:

1. Create plugin folder
2. Implement interface
3. Register plugin in Orchestrator

NO core changes required.

## 24. Summary

Plugins are the extensibility engine of SISU'M.

They allow the platform to scale from:

- EC2 optimization (MVP)
- → RDS, EBS, S3
- → Kubernetes
- → Multi-cloud (Azure/GCP)
- → Enterprise optimization intelligence

Without changing the Core Platform.

### Final Statement

If the Core Platform is the brain, plugins are the instincts.

They make SISU'M expandable, safe, and future-proof.
