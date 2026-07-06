# Database Design Specification

**Project:** SISU'M Cloud Optimization Platform

**Version:** 1.0

**Database:** AWS DynamoDB + S3 (Hybrid Storage Model)

## 1. Purpose

This document defines:

- Data entities
- DynamoDB table design
- Access patterns
- Index strategy
- Data lifecycle
- Storage separation rules (DynamoDB vs S3)

The goal is to ensure:

> The system is fast, scalable, event-driven, and plugin-agnostic.

## 2. Database Design Principles

The database must follow:

- Single-table design (where appropriate)
- Access-pattern-driven modeling
- No relational joins
- No cross-table dependencies in queries
- High write efficiency for workflows
- Immutable event history where possible
- Separation of hot vs cold data

## 3. Storage Architecture Overview

```
DynamoDB (Hot Data)
    ├── Workflows
    ├── Recommendations
    ├── Evidence (summary)
    ├── Plugins
    ├── Providers
    ├── Configuration

S3 (Cold Data)
    ├── Raw Metrics
    ├── Full Evidence Payloads
    ├── Historical Snapshots
    ├── Audit Logs
```

## 4. Core DynamoDB Table Design

### 4.1 Single Table Name

```
sisum-platform-table
```

### 4.2 Primary Key Structure

```
PK (Partition Key)   = ENTITY_TYPE#ID
SK (Sort Key)        = TIMESTAMP / STAGE / VERSION
```

### 4.3 Entity Types

| Entity | PK Format |
|---|---|
| Workflow | `WORKFLOW#id` |
| Recommendation | `RECOMMENDATION#id` |
| Evidence | `EVIDENCE#candidateId` |
| Plugin | `PLUGIN#name` |
| Provider | `PROVIDER#name` |
| Config | `CONFIG#global` |

## 5. Entities Schema

### 5.1 Workflow Entity

```json
{
  "PK": "WORKFLOW#wf_123",
  "SK": "META",
  "workflowId": "wf_123",
  "plugin": "ec2",
  "status": "running",
  "currentStage": "governance",
  "createdAt": "2026-07-06T10:00:00Z",
  "updatedAt": "2026-07-06T10:05:00Z"
}
```

**Workflow Stage Records**

```json
{
  "PK": "WORKFLOW#wf_123",
  "SK": "STAGE#evidence",
  "status": "completed",
  "durationMs": 1200
}
```

### 5.2 Recommendation Entity

```json
{
  "PK": "RECOMMENDATION#rec_001",
  "SK": "META",
  "plugin": "ec2",
  "workflowId": "wf_123",
  "confidence": 0.92,
  "readiness": 0.88,
  "createdAt": "2026-07-06T10:02:00Z"
}
```

**Financial Sub-Record**

```json
{
  "PK": "RECOMMENDATION#rec_001",
  "SK": "FINANCIAL",
  "monthlySavings": 26.6,
  "annualSavings": 319.2
}
```

### 5.3 Evidence Entity

Evidence is split between DynamoDB (summary) and S3 (raw data).

**DynamoDB Summary**

```json
{
  "PK": "EVIDENCE#i-123",
  "SK": "SUMMARY",
  "cpuAvg": 12,
  "memoryAvg": 34,
  "cost": 85.2,
  "lastUpdated": "2026-07-06T09:50:00Z"
}
```

**Raw Evidence (S3 Pointer)**

```json
{
  "PK": "EVIDENCE#i-123",
  "SK": "RAW",
  "s3Location": "s3://sisum-evidence/i-123/full.json"
}
```

### 5.4 Plugin Entity

```json
{
  "PK": "PLUGIN#ec2",
  "SK": "META",
  "version": "1.0",
  "status": "active",
  "capabilities": [
    "rightsizing",
    "optimization"
  ]
}
```

### 5.5 Provider Entity

```json
{
  "PK": "PROVIDER#aws",
  "SK": "META",
  "status": "active",
  "region": "us-east-1"
}
```

### 5.6 Configuration Entity

```json
{
  "PK": "CONFIG#global",
  "SK": "ACTIVE",
  "mode": "mock",
  "provider": "mock",
  "loggingLevel": "info"
}
```

## 6. Global Secondary Indexes (GSIs)

### GSI-1: Workflow by Status

```
GSI1PK = status
GSI1SK = createdAt
```

Use case:

- list running workflows
- track failures
- monitor system health

### GSI-2: Plugin Activity

```
GSI2PK = plugin
GSI2SK = createdAt
```

Use case:

- plugin analytics
- usage tracking
- performance comparison

### GSI-3: Recommendations by Confidence

```
GSI3PK = plugin
GSI3SK = confidence
```

Use case:

- high-confidence recommendations
- filtering decision-quality outputs

## 7. Access Patterns (CRITICAL)

This is the MOST important section.

### 7.1 Workflow Access Patterns

| Query | Method |
|---|---|
| Get workflow | `PK = WORKFLOW#id` |
| Get stages | `PK = WORKFLOW#id` |
| List running workflows | GSI1 |
| Retry workflow | PK update |

### 7.2 Recommendation Access Patterns

| Query | Method |
|---|---|
| Get recommendation | PK |
| List by plugin | GSI2 |
| Filter high confidence | GSI3 |

### 7.3 Evidence Access Patterns

| Query | Method |
|---|---|
| Get summary | PK |
| Get raw evidence | S3 |
| Update metrics | PK update |

### 7.4 Plugin Access Patterns

| Query | Method |
|---|---|
| List plugins | PK scan |
| Get plugin | PK lookup |

### 7.5 Provider Access Patterns

| Query | Method |
|---|---|
| Get provider status | PK lookup |
| Switch provider | update CONFIG |

## 8. Data Lifecycle

### 8.1 Hot Data (DynamoDB)

Stored:

- Workflows
- Recommendations
- Evidence summaries
- Plugin metadata
- Config

Retention:

- 30–90 days

### 8.2 Cold Data (S3)

Stored:

- Full evidence payloads
- Historical metrics
- Audit logs
- Verification snapshots

Retention:

- 1–7 years (configurable)

### 8.3 Archival Strategy

```
DynamoDB → S3 → Glacier (future)
```

### 8.4 Deletion Policy

- Workflows: soft delete
- Recommendations: retained for audit
- Evidence: archived not deleted
- Logs: lifecycle-managed

## 9. Event-to-Data Mapping

| Event | Storage |
|---|---|
| `workflow.started` | DynamoDB |
| `evidence.collected` | DynamoDB + S3 |
| `recommendation.generated` | DynamoDB |
| `verification.done` | DynamoDB |
| `learning.updated` | S3 + DynamoDB |

## 10. Consistency Model

- Strong consistency for workflows
- Eventual consistency for analytics
- Read-after-write for recommendations

## 11. Performance Strategy

- Use batch writes for plugins
- Cache evidence summaries
- Avoid repeated AWS calls
- Use GSIs instead of scans
- Keep items < 400KB (DynamoDB limit safe usage)

## 12. Cost Optimization Strategy

To keep AWS cost low:

- Minimize scan operations
- Prefer query over scan
- Use S3 for large payloads
- Store only computed summaries in DynamoDB
- Archive inactive workflows

## 13. Security Rules

- Encrypt sensitive data at rest
- Use IAM roles per service
- Never store AWS credentials in DB
- Separate config per environment

## 14. Data Integrity Rules

- Every workflow must have a unique ID
- Every recommendation must link to a workflow
- Every verification must reference a recommendation
- Every evidence record must reference a candidate

This ensures full traceability:

**Candidate → Evidence → Recommendation → Execution → Verification → Learning**

## 15. Summary

This database design ensures:

- ✔ Scalable event-driven architecture
- ✔ Plugin-agnostic storage
- ✔ Cost-efficient AWS usage
- ✔ Full traceability of decisions
- ✔ Separation of hot and cold data
- ✔ Support for multi-cloud expansion

### Final Statement

The database is not just storage.

It is the audit trail of intelligence inside SISU'M.

Every optimization decision must be traceable through this system.
