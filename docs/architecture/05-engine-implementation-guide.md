# Engine Implementation Guide

**Project:** SISU'M Cloud Optimization Decision Platform

**Version:** 1.0

**Status:** Sprint 0 Foundation Document

**Depends On:**

* 00-project-philosophy.md
* 01-architecture-specification.md
* 02-api-specification.md
* 03-database-design.md
* 04-plugin-specification.md

---

# 1. Purpose

This document defines how engineers must implement the Core Engines.

The Core Engines contain the permanent business logic of SISU'M.

Unlike plugins, they are not resource-specific.

They coordinate every optimization workflow regardless of whether the resource is:

* EC2
* RDS
* EBS
* S3
* Lambda
* Kubernetes
* Azure
* Google Cloud

The Core Engines are long-lived architectural components.

---

# 2. Core Platform

The permanent platform consists of:

```text
Orchestrator

Evidence Engine

Governance Engine

Financial Engine

Verification Engine

Learning Engine
```

These engines must never be duplicated.

---

# 3. Repository Structure

```text
backend/

src/

engines/

evidence/

governance/

financial/

verification/

learning/

orchestrator/

plugins/

providers/

api/

shared/
```

Only the `plugins/` folder grows over time.

---

# 4. Engine Design Principles

Every engine must be:

✔ Stateless

✔ Deterministic

✔ Independently testable

✔ Provider-agnostic

✔ Plugin-agnostic

✔ Side-effect aware

Every engine receives data.

Every engine returns data.

No engine should directly modify AWS resources.

---

# 5. Standard Engine Interface

Every engine must implement the same interface pattern.

```typescript
export interface Engine<Input, Output> {

execute(input: Input): Promise<Output>

}
```

Example:

```typescript
class EvidenceEngine
implements Engine<EvidenceRequest, EvidenceResult> {

async execute(request: EvidenceRequest) {

}

}
```

This keeps all engines consistent.

---

# 6. Shared Data Contracts

All engines exchange strongly typed objects.

Example:

```typescript
interface WorkflowContext {

workflowId: string

plugin: string

provider: string

candidate: Candidate

}
```

The `WorkflowContext` flows through every engine.

---

# 7. Evidence Engine

## Purpose

Collect all information required for evaluation.

---

### Responsibilities

* Request data from Provider Layer
* Normalize provider responses
* Validate completeness
* Produce Evidence Object

---

### Inputs

* WorkflowContext
* Candidate

---

### Outputs

```typescript
EvidenceResult
```

---

### Must Never

* Estimate savings
* Make recommendations
* Perform governance
* Execute AWS changes

---

### Internal Modules

```text
evidence/

engine.ts

collector.ts

normalizer.ts

validator.ts

mapper.ts
```

---

# 8. Governance Engine

## Purpose

Determine whether recommendations are permitted.

---

### Responsibilities

Evaluate:

* Environment
* Business policy
* Approval requirements
* Risk level
* Maintenance windows

---

### Inputs

EvidenceResult

Recommendation

---

### Outputs

```typescript
GovernanceDecision
```

---

### Decision Types

* Approved
* NeedsApproval
* Rejected

---

### Internal Modules

```text
governance/

engine.ts

policies.ts

rules.ts

approvals.ts
```

---

# 9. Financial Engine

## Purpose

Estimate financial impact.

---

### Responsibilities

Calculate:

* Current monthly cost
* Proposed cost
* Monthly savings
* Annual savings
* ROI

---

### Inputs

Evidence

Recommendation

---

### Outputs

```typescript
FinancialImpact
```

---

### Internal Modules

```text
financial/

engine.ts

pricing.ts

calculator.ts

roi.ts
```

---

# 10. Verification Engine

## Purpose

Determine whether expected outcomes were achieved.

---

### Responsibilities

Compare:

Expected

↓

Observed

↓

Variance

↓

Status

---

### Outputs

```typescript
VerificationResult
```

---

### Internal Modules

```text
verification/

engine.ts

comparator.ts

validator.ts
```

---

# 11. Learning Engine

## Purpose

Persist optimization outcomes.

---

### Responsibilities

Store:

* Evidence
* Recommendation
* Governance
* Verification

Future ML models consume this data.

---

### Outputs

LearningRecord

---

### Internal Modules

```text
learning/

engine.ts

repository.ts

serializer.ts
```

---

# 12. Workflow Orchestrator

## Purpose

Coordinate every engine.

---

### Responsibilities

Start workflow

↓

Evidence Engine

↓

Plugin

↓

Governance Engine

↓

Financial Engine

↓

Verification Engine

↓

Learning Engine

---

### Orchestrator Never

* Calculates savings
* Reads CloudWatch
* Implements optimization logic

---

### Internal Modules

```text
orchestrator/

engine.ts

workflow.ts

dispatcher.ts

retry.ts
```

---

# 13. Engine Communication Rules

Allowed

Engine

↓

Engine

↓

Engine

Not Allowed

Plugin

↓

Plugin

Provider

↓

Engine

Engine

↓

AWS SDK

---

# 14. Error Handling

Every engine returns:

```typescript
Result<T>
```

Example:

```typescript
interface Result<T>{

success:boolean

data?:T

error?:EngineError

}
```

Never throw raw exceptions across engine boundaries.

---

# 15. Logging Standard

Each engine logs:

* Workflow ID
* Engine Name
* Duration
* Result
* Timestamp

Example:

```json
{
"engine":"Evidence",
"workflowId":"wf123",
"duration":321
}
```

---

# 16. Testing Strategy

Each engine requires:

## Unit Tests

Business logic only.

---

## Integration Tests

Engine + Plugin

---

## Mock Provider Tests

Provider-independent verification.

---

## Workflow Tests

Entire pipeline.

---

# 17. Performance Guidelines

Engines should:

* Batch operations
* Cache reusable evidence
* Avoid duplicate provider requests
* Avoid blocking operations

---

# 18. Security Guidelines

Engines must never:

* Log secrets
* Store credentials
* Bypass governance
* Access production infrastructure directly

---

# 19. Dependency Rules

Allowed

```text
Engine

↓

Shared Types

↓

Provider Interface
```

Forbidden

```text
Engine

↓

AWS SDK

↓

Database

↓

Plugin

↓

Another Provider
```

Database access must occur through repositories, not directly inside engine logic.

---

# 20. Engine Lifecycle

Every engine follows:

```text
Receive Context

↓

Validate Input

↓

Execute Business Logic

↓

Return Typed Result

↓

Log Outcome
```

No engine should mutate shared state unexpectedly.

---

# 21. Definition of Complete

An engine is complete only when it has:

* Business logic implemented
* Input validation
* Output contracts
* Error handling
* Structured logging
* Unit tests
* Integration tests
* Documentation
* TypeScript typing

---

# 22. Future Evolution

Core Engines are designed to remain stable.

Future improvements may include:

* Machine learning scoring
* Adaptive confidence calibration
* AI-assisted explanations
* Multi-cloud policy engines

These enhancements should extend existing engines rather than replace them.

---

# 23. Engineering Checklist

Before merging an engine:

* Correct folder placement
* Uses standard Engine interface
* No direct AWS SDK usage
* Uses Provider Layer
* Returns typed results
* Logs execution
* Includes tests
* Updates documentation
* Reviewed by Tech Lead

---

# 24. Summary

The Core Engines are the permanent decision-making foundation of SISU'M.

Each engine has a single responsibility:

* Evidence Engine → Collect facts
* Governance Engine → Enforce policy
* Financial Engine → Estimate impact
* Verification Engine → Confirm outcomes
* Learning Engine → Capture knowledge
* Orchestrator → Coordinate everything

Plugins provide optimization expertise.

Providers abstract cloud infrastructure.

Together they create a modular, scalable, and cloud-agnostic decision platform.

---

# Final Statement

The Core Platform is the product.

Plugins add capabilities.

Providers connect infrastructure.

Every implementation decision must preserve this separation of concerns.

When in doubt:

**Move infrastructure concerns into Providers, optimization logic into Plugins, business rules into Engines, and workflow coordination into the Orchestrator.**
