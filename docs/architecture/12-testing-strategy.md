# Testing Strategy

**Project:** SISU'M Cloud Optimization Decision Platform
**Version:** 1.0
**Status:** Sprint 0 Foundation Document

---

# 1. Purpose

This document defines the complete testing strategy for SISU'M.

It ensures that:

* every layer is independently testable
* system behavior is deterministic and verifiable
* AWS interactions are safely simulated
* regressions are prevented
* AI-generated code (Cursor) remains safe

Testing is not optional. It is a **core architectural requirement**.

---

# 2. Core Testing Philosophy

> If a feature is not tested, it does not exist.

SISU'M follows a **test-first reliability model**, meaning:

* behavior must be verifiable before deployment
* every decision path must be predictable
* every AWS interaction must be mockable

---

# 3. Testing Pyramid

SISU'M uses a strict layered testing model:

```text id="test_pyramid"
        E2E Tests
      Integration Tests
    Engine + Plugin Tests
  Provider Mock Tests
Unit Tests (Core Logic)
```

---

# 4. Test Types Overview

## 4.1 Unit Tests

Test individual functions and logic.

### Scope:

* Engines (pure logic)
* Financial calculations
* Governance rules
* Validation utilities

### Rules:

✔ No AWS calls
✔ No database calls
✔ Fully deterministic

---

## 4.2 Integration Tests

Test interaction between modules.

### Scope:

* Engine → Plugin
* Plugin → Provider
* Orchestrator → Engines

### Rules:

✔ Mock AWS provider allowed
✔ Database mock allowed
✔ Must simulate real workflows

---

## 4.3 Provider Tests

Test AWS abstraction layer.

### Scope:

* EC2 provider
* RDS provider
* S3 provider
* CloudWatch provider

### Rules:

✔ Must pass in BOTH:

* AWS mode (sandbox)
* Mock mode

✔ Must not include business logic

---

## 4.4 Workflow (End-to-End) Tests

Test full system behavior.

### Flow:

```text id="e2e_flow"
API Request
    ↓
Orchestrator
    ↓
Engines
    ↓
Plugins
    ↓
Providers
    ↓
Mock AWS
    ↓
Final Output
```

### Rules:

✔ Must simulate real optimization scenario
✔ Must validate full lifecycle
✔ Must include verification step

---

## 4.5 Mock Tests (Default Development Mode)

All development must use Mock Mode first.

### Scope:

* fake EC2 instances
* simulated CloudWatch metrics
* dummy pricing data

### Purpose:

* zero AWS cost during development
* fast iteration cycles
* deterministic testing

---

# 5. Testing Requirements by Layer

## 5.1 Engines

Must have:

✔ Unit tests
✔ Deterministic outputs
✔ Edge case coverage

---

## 5.2 Plugins

Must have:

✔ Integration tests with mock providers
✔ Output validation tests
✔ No AWS dependency tests

---

## 5.3 Providers

Must have:

✔ Mock provider parity tests
✔ AWS sandbox tests (optional)
✔ Response normalization tests

---

## 5.4 Orchestrator

Must have:

✔ Full workflow simulation tests
✔ Failure recovery tests
✔ Retry mechanism tests

---

## 5.5 API Layer

Must have:

✔ Request validation tests
✔ Response schema tests
✔ Error handling tests

---

# 6. Mock Strategy (CRITICAL)

SISU'M MUST always support Mock Mode.

## 6.1 Mock Provider Requirements

Mock provider must simulate:

* EC2 instances
* RDS databases
* EBS volumes
* S3 buckets
* CloudWatch metrics

---

## 6.2 Mock Data Rules

Mock data must:

✔ Be realistic
✔ Reflect production scenarios
✔ Include edge cases
✔ Support scaling tests

---

## 6.3 Example Mock EC2 Data

```typescript id="mock_ec2"
{
  instanceId: "i-mock123",
  instanceType: "t3.medium",
  cpuUtilization: 12,
  memoryUtilization: 45,
  region: "us-east-1"
}
```

---

# 7. Deterministic Testing Rule

All critical systems must produce:

✔ Same input → same output
✔ No randomness in engines
✔ No time-based variation unless mocked

---

# 8. Test Data Strategy

## 8.1 Test Data Types

* Small datasets → unit tests
* Medium datasets → integration tests
* Large datasets → performance tests

---

## 8.2 Data Isolation Rule

✔ Test data must never touch production data
✔ Each test must clean up after itself

---

# 9. Performance Testing Strategy

Performance tests must validate:

* workflow execution time
* provider response latency
* engine processing efficiency

---

## Performance Benchmarks (MVP)

| Component        | Target  |
| ---------------- | ------- |
| Engine execution | < 50ms  |
| Provider calls   | < 300ms |
| Full workflow    | < 2s    |

---

# 10. Failure Testing Strategy

Every system must be tested under failure conditions:

✔ AWS timeout
✔ Missing data
✔ Invalid inputs
✔ Partial workflow failure
✔ Plugin failure

---

# 11. Regression Testing

Every new change must ensure:

✔ Existing workflows still function
✔ No breaking changes in engine contracts
✔ No plugin output changes without versioning

---

# 12. CI Testing Requirements

Every Pull Request must pass:

✔ Unit tests
✔ Integration tests
✔ Linting
✔ Type checks
✔ Mock workflow tests

No exceptions.

---

# 13. Test Environment Strategy

## Environments:

| Environment | Purpose         |
| ----------- | ---------------- |
| Local       | Development     |
| Mock        | Default testing |
| Staging     | Pre-production  |
| Production  | Live system     |

---

# 14. Test Automation Rules

✔ Tests must run automatically on PR
✔ Tests must block merges if failing
✔ No manual testing allowed for core engines

---

# 15. Coverage Requirements

| Layer        | Minimum Coverage |
| ------------ | ---------------- |
| Engines      | 90%              |
| Plugins      | 85%              |
| Providers    | 85%              |
| API          | 80%              |
| Orchestrator | 90%              |

---

# 16. Observability Testing

Tests must validate:

* logs are generated
* workflow IDs exist
* errors are structured
* execution traces are complete

---

# 17. Security Testing

Tests must ensure:

✔ No secrets exposed
✔ No unauthorized AWS access
✔ No privilege escalation
✔ Input sanitization works

---

# 18. AI / Cursor Testing Rules

Cursor AI MUST:

✔ Generate test files for every feature
✔ Follow testing pyramid structure
✔ Include mock tests by default
✔ Never skip integration tests for engines or providers

---

# 19. Anti-Patterns (STRICTLY FORBIDDEN)

❌ Writing code without tests
❌ Testing only happy paths
❌ Skipping provider mock tests
❌ Mixing unit and integration tests
❌ Testing AWS directly without mocks
❌ Manual-only verification

---

# 20. Definition of a Good Test

A good test is:

* deterministic
* fast
* isolated
* readable
* meaningful
* failure-explanatory

---

# 21. Test Naming Convention

```text id="test_naming"
should_calculate_monthly_savings_correctly
should_reject_invalid_ec2_instances
should_trigger_governance_failure_on_policy_violation
```

---

# 22. Final Principle

> If a system cannot be tested, it cannot be trusted.

Testing is not validation after development — it is part of system design.

---

# End of Testing Strategy
