# Engineering Standards

**Project:** SISU'M Cloud Optimization Decision Platform

**Version:** 1.0

**Status:** Sprint 0 Foundation Document

---

# 1. Purpose

This document defines the engineering standards for the SISU'M platform.

Every engineer and every AI coding assistant (including Cursor AI) must follow these standards.

The objectives are to:

* Maintain a consistent codebase
* Prevent architectural drift
* Improve maintainability
* Reduce defects
* Support long-term scalability

---

# 2. Engineering Principles

Every engineering decision must align with these principles:

1. Simplicity over cleverness
2. Modular design over monolithic code
3. Reuse over duplication
4. Readability over brevity
5. Deterministic behavior over hidden side effects
6. Testability by design
7. Documentation is part of the deliverable

---

# 3. Repository Structure

The repository must follow this layout:

```text
backend/
    src/
        api/
        engines/
        plugins/
        providers/
        orchestrator/
        repositories/
        shared/
        types/
        utils/

frontend/
    src/
        components/
        pages/
        layouts/
        hooks/
        services/
        types/
        assets/

docs/
    architecture/
```

No engineer should introduce new top-level folders without Tech Lead approval.

---

# 4. Folder Ownership

Primary ownership helps prevent duplicate work while still allowing collaboration.

| Folder        | Primary Owner | Secondary Owner |
| ------------- | ------------- | --------------- |
| engines       | Mpho          | Florence        |
| orchestrator  | Mpho          | Obianuju        |
| providers     | Florence      | Mpho            |
| plugins       | Obianuju      | Florence        |
| api           | Florence      | Mpho            |
| frontend      | Obianuju      | Florence        |
| shared        | All Engineers | Tech Lead       |
| documentation | All Engineers | Tech Lead       |

Ownership does **not** mean exclusivity.

It means responsibility for architectural consistency.

---

# 5. Coding Standards

Every file must:

* Have one clear responsibility
* Use descriptive names
* Avoid duplicated logic
* Avoid unnecessary abstractions
* Use TypeScript strict mode
* Export only what is needed

---

# 6. Naming Conventions

## Files

```text
evidence.engine.ts
workflow.controller.ts
pricing.service.ts
ec2.plugin.ts
aws.provider.ts
```

Use:

* lowercase
* kebab-case for multi-word file names

---

## Classes

```typescript
EvidenceEngine
WorkflowOrchestrator
AwsProvider
FinancialEngine
```

Use PascalCase.

---

## Interfaces

```typescript
Engine
CloudProvider
Recommendation
WorkflowContext
```

Use PascalCase.

Do **not** prefix interfaces with `I`.

---

## Variables

```typescript
workflowId
monthlySavings
verificationStatus
```

Use camelCase.

---

## Constants

```typescript
MAX_RETRIES
DEFAULT_REGION
```

Use UPPER_SNAKE_CASE.

---

# 7. Architecture Rules

The following dependency flow is mandatory:

```text
API
↓

Orchestrator
↓

Core Engines
↓

Plugins
↓

Providers
↓

AWS / Mock
```

Reverse dependencies are forbidden.

---

# 8. Forbidden Dependencies

The following are **not allowed**:

❌ API calling AWS SDK

❌ Plugins calling DynamoDB

❌ Engines calling AWS SDK

❌ Providers containing business logic

❌ Plugins calling other plugins

❌ Circular imports

---

# 9. Business Logic Rules

Business logic belongs only in Core Engines.

Examples:

✔ Governance decisions

✔ Financial calculations

✔ Verification logic

✔ Workflow coordination

Plugins should only implement optimization behavior.

Providers should only communicate with infrastructure.

---

# 10. Error Handling Standards

Every function must return structured errors.

Preferred pattern:

```typescript
Result<T>
```

Never expose raw exceptions outside module boundaries.

Every error must include:

* code
* message
* source
* retryable flag

---

# 11. Logging Standards

Every workflow step must log:

* workflowId
* requestId
* plugin
* engine
* duration
* result

Sensitive information must never be logged.

---

# 12. TypeScript Standards

Enable strict mode.

Avoid:

* any
* implicit any
* unknown return types

Every exported function must define:

* parameter types
* return type

---

# 13. Testing Requirements

Every new feature must include tests.

Required minimum:

## Unit Tests

Test business logic in isolation.

---

## Integration Tests

Test interaction between:

* Engine + Plugin
* Plugin + Provider
* Orchestrator + Engines

---

## Mock Provider Tests

Every provider feature must work using:

* Mock Provider
* AWS Provider

with identical interfaces.

---

# 14. Test Coverage Targets

| Component        | Minimum Coverage |
| ---------------- | ---------------- |
| Engines          | 90%              |
| Providers        | 85%              |
| Plugins          | 85%              |
| API              | 80%              |
| Shared Utilities | 90%              |

Coverage is a target—not an excuse for poor-quality tests.

---

# 15. Documentation Requirements

Every exported class must include:

* purpose
* inputs
* outputs

Complex workflows must include diagrams or markdown documentation.

Architecture changes must update the relevant document in `docs/architecture`.

---

# 16. Pull Request Standards

Every Pull Request must:

* Solve one logical task
* Be linked to a backlog item
* Pass all automated tests
* Include documentation updates (if applicable)
* Avoid unrelated changes

Large "catch-all" Pull Requests are discouraged.

---

# 17. Code Review Checklist

Reviewers must verify:

### Architecture

* Correct layer placement
* No architecture violations
* Correct dependency direction

### Code Quality

* Readable
* Maintainable
* Typed correctly
* No duplicated logic

### Testing

* Tests added
* Tests meaningful
* Existing tests still pass

### Documentation

* Updated where necessary

---

# 18. Performance Guidelines

Prefer:

* Batch operations
* Cached metadata
* Query over scan
* Async processing

Avoid:

* Nested loops on large datasets
* Duplicate provider calls
* Blocking operations

---

# 19. Security Standards

Never:

* Commit secrets
* Hardcode credentials
* Expose AWS account details
* Log tokens
* Disable authentication checks in production

Use environment variables and secure secret management.

---

# 20. Git Commit Standards

Commit messages should follow:

```text
feat: add EC2 evidence collector

fix: resolve workflow retry bug

docs: update API specification

refactor: simplify governance engine

test: add verification engine tests

chore: update dependencies
```

---

# 21. Branch Strategy

Main branches:

```text
main
develop
```

Feature branches:

```text
feature/ec2-plugin
feature/governance-engine
feature/workflow-api
bugfix/verification
docs/database-design
```

Direct commits to `main` are not allowed.

---

# 22. AI Development Guidelines

Cursor AI and other coding assistants must:

* Follow repository architecture
* Respect engine/plugin/provider separation
* Never introduce direct AWS SDK usage outside Providers
* Never bypass the Orchestrator
* Never generate duplicate business logic
* Preserve existing architecture unless explicitly instructed

AI-generated code must always be reviewed by a human engineer.

---

# 23. Definition of Quality

Good code is:

* Easy to understand
* Easy to test
* Easy to replace
* Easy to extend
* Easy to document

Optimization should never reduce readability unless justified by measurable performance requirements.

---

# 24. Engineering Decision Framework

Before implementing any feature, ask:

1. Does it follow the architecture?
2. Does it belong in the correct layer?
3. Can it be tested independently?
4. Does it duplicate existing functionality?
5. Does it help deliver MVP value?
6. Will it remain useful as the platform grows?

If any answer is "No", redesign before implementation.

---

# 25. Final Engineering Checklist

Before merging any work:

* Architecture respected
* Correct folder used
* TypeScript strict mode satisfied
* Tests written
* Documentation updated
* Logging implemented
* Error handling complete
* No duplicated logic
* Pull Request reviewed
* CI pipeline passes

---

# 26. Summary

Engineering standards ensure that SISU'M remains:

* Modular
* Testable
* Maintainable
* Cost-efficient
* Cloud-agnostic
* Easy to extend

These standards apply equally to engineers and AI-assisted development.

---

# Final Statement

Every line of code should make the platform easier to understand, easier to test, and easier to evolve.

When faced with multiple implementation options, choose the one that best preserves the architecture, reduces long-term maintenance, and supports the future growth of SISU'M as a Cloud Optimization Decision Platform.
