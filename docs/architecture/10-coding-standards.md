# Coding Standards

**Project:** SISU'M Cloud Optimization Decision Platform
**Version:** 1.0
**Status:** Sprint 0 Foundation Document

---

# 1. Purpose

This document defines the **strict coding rules** for all engineers and AI systems (including Cursor AI) working on SISU'M.

It ensures:

* consistent code style
* predictable system behavior
* easy debugging
* scalable architecture
* zero architectural violations

If code does not follow these rules, it is considered **invalid implementation**, even if it runs.

---

# 2. Core Coding Philosophy

> Write code for humans first, machines second, and future engineers third.

All code must be:

* readable
* predictable
* testable
* modular
* explicit

Avoid:

* clever tricks
* hidden logic
* implicit behavior
* unnecessary abstraction

---

# 3. Language Standard

## 3.1 Primary Language

* TypeScript (strict mode enabled)

## 3.2 Forbidden Patterns

❌ JavaScript without types
❌ `any` usage
❌ implicit return types
❌ dynamic runtime type guessing

---

# 4. File Structure Standards

Each file must contain **one responsibility only**.

## Example:

✔ GOOD

```text
evidence.engine.ts
```

✔ BAD

```text
engine.utils.helpers.logic.ts
```

---

## File Naming Convention

```text
{domain}.{layer}.ts
```

Examples:

* `evidence.engine.ts`
* `ec2.plugin.ts`
* `aws.provider.ts`
* `workflow.orchestrator.ts`

---

# 5. Code Organization Rules

Each file must follow this order:

```text
1. Imports
2. Types / Interfaces
3. Constants
4. Core Class / Function
5. Helper functions (if necessary)
6. Export
```

No mixing of concerns.

---

# 6. Function Design Rules

## 6.1 Function Size

* Maximum: 50–80 lines
* If larger → split into smaller functions

---

## 6.2 Function Responsibility

Each function must do **ONE thing only**

✔ Good:

```typescript
calculateMonthlySavings()
```

❌ Bad:

```typescript
calculateSavingsAndTriggerWorkflowAndLog()
```

---

## 6.3 Function Naming

Functions must:

* be descriptive
* be action-based
* use verbs

Examples:

✔ `validateEvidence()`

✔ `buildWorkflowContext()`

✔ `calculateFinancialImpact()`

---

# 7. Type Safety Rules

## 7.1 Mandatory Types

Every function must define:

* input types
* return types

---

## 7.2 Forbidden Types

❌ `any`

❌ untyped objects

❌ implicit return types

---

## 7.3 Preferred Pattern

```typescript
function calculateImpact(
  input: FinancialInput
): FinancialResult
```

---

# 8. Error Handling Standards

## 8.1 No Raw Exceptions Across Layers

Never do:

```typescript
throw new Error("something broke")
```

---

## 8.2 Standard Error Format

```typescript
interface AppError {
  code: string
  message: string
  source: string
  retryable: boolean
}
```

---

## 8.3 Result Pattern (Mandatory)

```typescript
interface Result<T> {
  success: boolean
  data?: T
  error?: AppError
}
```

---

# 9. Logging Standards

## 9.1 Required Logs

Every function in Engines/Plugins/Providers must log:

* workflowId
* function name
* execution time
* result status

---

## 9.2 Forbidden Logs

❌ secrets
❌ AWS credentials
❌ full payload dumps
❌ sensitive financial data

---

## 9.3 Logging Format

```json
{
  "workflowId": "wf_123",
  "module": "EvidenceEngine",
  "status": "success",
  "durationMs": 120
}
```

---

# 10. Dependency Rules

## 10.1 Allowed Imports

✔ Shared types
✔ Utility functions
✔ Local module dependencies

---

## 10.2 Forbidden Imports

❌ AWS SDK inside Engines
❌ Database access inside Plugins
❌ Cross-plugin imports
❌ Circular dependencies

---

## 10.3 Architecture Enforcement

```text
Engines → Plugins → Providers → AWS
```

No reverse direction allowed.

---

# 11. State Management Rules

## 11.1 Stateless Design (Mandatory for Engines)

Engines must NOT:

* store state
* mutate global variables
* cache business logic results

---

## 11.2 Allowed State Locations

✔ Database
✔ Orchestrator context
✔ Provider responses

---

# 12. Async Handling Standards

## 12.1 Always Use Async/Await

❌ No nested callbacks
❌ No `.then()` chains

✔ Preferred:

```typescript
const result = await fetchData()
```

---

## 12.2 Parallel Execution

Use `Promise.all` when safe:

```typescript
await Promise.all([
  fetchEC2(),
  fetchRDS(),
  fetchEBS()
])
```

---

# 13. Validation Rules

All external inputs must be validated.

Validation must include:

* type checking
* required fields
* range checks
* schema validation

Never trust:

* API inputs
* plugin outputs
* provider responses

---

# 14. Performance Rules

## 14.1 Avoid Redundant Calls

❌ Multiple AWS calls for same data
❌ Re-fetching unchanged data

---

## 14.2 Prefer Batching

✔ Batch AWS requests where possible
✔ Cache pricing data
✔ Reuse provider responses

---

# 15. Security Rules (Code-Level)

## Forbidden:

❌ Hardcoded secrets
❌ Direct AWS SDK usage outside provider
❌ Logging sensitive data
❌ Unsafe eval usage
❌ Dynamic code execution

---

# 16. Testing Requirements (Code-Level)

Every module must include:

## 16.1 Unit Tests

* pure functions
* deterministic logic

---

## 16.2 Integration Tests

* engine + plugin interaction
* provider responses

---

## 16.3 Mock Tests

* must run without AWS
* must simulate real responses

---

# 17. Code Reusability Rules

✔ Reuse shared utilities
✔ Extract repeated logic
✔ Avoid duplication across plugins

---

# 18. Anti-Patterns (STRICTLY FORBIDDEN)

❌ God functions (>150 lines)
❌ Business logic in API routes
❌ AWS SDK in engines
❌ duplicated calculation logic
❌ untyped objects
❌ silent failures
❌ deeply nested logic (>3 levels)

---

# 19. Refactoring Rules

Code MUST be refactored when:

* it is duplicated
* it exceeds complexity limits
* it violates layering rules
* it becomes unreadable

Refactoring is not optional.

---

# 20. AI / Cursor Coding Rules

Cursor AI MUST:

✔ Follow file structure strictly
✔ Respect engine/plugin/provider boundaries
✔ Never bypass architecture
✔ Never introduce AWS SDK directly
✔ Always use typed patterns
✔ Avoid over-engineering

AI-generated code is treated as draft until reviewed.

---

# 21. Code Review Standards

Every PR must be checked for:

* readability
* architecture compliance
* test coverage
* error handling
* logging compliance
* type safety

---

# 22. Definition of Good Code

Good code is:

* simple
* explicit
* modular
* predictable
* testable

Not:

* clever
* compressed
* implicit
* overly abstract

---

# 23. Final Rule

> If another engineer cannot understand the code in 30 seconds, it is too complex.

---

# 24. Conclusion

These coding standards ensure SISU'M remains:

* scalable
* maintainable
* safe
* predictable
* cloud-agnostic
* AI-friendly

They are not suggestions.

They are **enforced engineering rules** for every line of code written in the system.

---

# End of Coding Standards
