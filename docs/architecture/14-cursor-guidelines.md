# Cursor AI Development Guidelines

**Project:** SISU'M Cloud Optimization Decision Platform
**Version:** 1.0
**Status:** Sprint 0 Foundation Document

---

# 1. Purpose

This document defines how **Cursor AI must behave when generating, modifying, or refactoring code in this repository.**

It ensures:

* architecture is not violated by AI
* engines/plugins/providers remain cleanly separated
* no hidden business logic leaks into wrong layers
* consistent implementation across all engineers and AI agents

---

# 2. Core Principle for AI

> Cursor AI is a coding assistant, not an architect.

It must:

* follow architecture
* not redesign system structure
* not introduce new patterns unless explicitly instructed
* not merge responsibilities across layers

---

# 3. Architecture Non-Negotiation Rule

Cursor AI MUST ALWAYS respect:

```text id="arch_rule"
API → Orchestrator → Engines → Plugins → Providers → AWS/Mock
```

It is strictly forbidden to:

❌ bypass layers
❌ collapse engines into APIs
❌ merge plugins into engines
❌ call AWS SDK directly
❌ introduce shortcuts between layers

---

# 4. Folder Discipline Rule

Cursor AI must NEVER:

❌ create new top-level folders
❌ move core architecture folders without instruction
❌ duplicate engine/plugin/provider logic

Allowed structure:

```text id="folder_rule"
engines/
plugins/
providers/
orchestrator/
api/
shared/
```

---

# 5. Code Generation Rules

## 5.1 Always Follow TypeScript Strict Mode

Cursor must always generate:

✔ fully typed code
✔ no `any` types
✔ explicit return types for functions

---

## 5.2 No Shortcut Logic

Cursor must NOT:

❌ compress multiple responsibilities into one function
❌ combine AWS + business logic
❌ inline complex orchestration logic in API routes

---

## 5.3 One Responsibility Rule

Every generated file must:

✔ do ONE thing only
✔ belong to ONE layer only

---

# 6. Engine Generation Rules

When generating engines, Cursor MUST:

✔ implement `Engine<Input, Output>` interface
✔ remain stateless
✔ avoid external dependencies
✔ never access AWS directly
✔ return structured results

---

# 7. Plugin Generation Rules

When generating plugins, Cursor MUST:

✔ ONLY contain optimization logic
✔ NOT perform governance decisions
✔ NOT calculate final financial outputs
✔ NOT access database directly
✔ NOT access AWS SDK

Plugins are "analysis units only".

---

# 8. Provider Generation Rules

When generating providers, Cursor MUST:

✔ encapsulate AWS SDK calls
✔ normalize AWS responses
✔ hide AWS-specific complexity
✔ expose clean interface to system

Providers are the ONLY AWS access layer.

---

# 9. Orchestrator Rules

Cursor must ensure:

✔ Orchestrator coordinates only
✔ Orchestrator does NOT compute logic
✔ Orchestrator does NOT make decisions
✔ Orchestrator does NOT access AWS

---

# 10. API Layer Rules

Cursor must ensure:

✔ APIs are thin controllers only
✔ APIs call orchestrator only
✔ no business logic inside APIs
✔ validation only at API layer

---

# 11. No Architecture Drift Rule

Cursor must NEVER:

❌ invent new layers
❌ rename core architectural components
❌ flatten system structure
❌ combine responsibilities across modules

If unsure → ASK before implementing.

---

# 12. Mock-First Development Rule

All generated code MUST support:

✔ Mock Mode
✔ AWS Mode

Cursor must ensure:

* every provider has mock equivalent
* every workflow can run without AWS
* no hard dependency on live cloud resources

---

# 13. Test Generation Rule

Cursor MUST ALWAYS generate:

✔ unit tests for logic
✔ integration tests for engines + plugins
✔ mock provider tests

No feature is complete without tests.

---

# 14. Error Handling Rule

Cursor MUST ALWAYS:

✔ use `Result<T>` pattern
✔ avoid raw exceptions across modules
✔ structure all error outputs
✔ include retryable flags where relevant

---

# 15. Logging Rule

Cursor-generated code must:

✔ include structured logging
✔ include workflowId where applicable
✔ avoid logging sensitive data
✔ log engine/plugin/provider identity

---

# 16. Anti-Refactor Rule

Cursor must NOT:

❌ refactor unrelated modules
❌ "clean up" architecture outside scope
❌ rename system-wide components without instruction

Only scoped changes are allowed per task.

---

# 17. Change Scope Rule

Every Cursor task must:

✔ affect only one domain
✔ modify only relevant layer
✔ avoid cross-layer changes unless explicitly requested

---

# 18. Dependency Rule

Cursor must enforce:

✔ Engines depend only on shared types
✔ Plugins depend only on providers (interface only)
✔ Providers depend only on AWS SDK
✔ API depends only on orchestrator

---

# 19. AI Decision Rule

Cursor must NEVER:

❌ decide system architecture
❌ introduce new design patterns
❌ override existing architecture decisions

It must strictly implement, not redesign.

---

# 20. Safe Refactoring Rule

Allowed refactoring:

✔ internal function improvements
✔ readability improvements
✔ type safety improvements

Not allowed:

❌ structural changes
❌ moving logic between layers
❌ merging modules across architecture boundaries

---

# 21. Debugging Rule

When fixing bugs, Cursor must:

✔ identify root cause
✔ avoid patch fixes that break architecture
✔ maintain layer separation
✔ add regression tests

---

# 22. Performance Rule

Cursor must:

✔ prefer batching over loops
✔ avoid redundant AWS calls
✔ cache provider responses when safe

But NEVER optimize by breaking architecture.

---

# 23. Documentation Rule

Any generated feature must include:

✔ inline comments (minimal but clear)
✔ updated architecture notes if impacted
✔ README updates if user-facing

---

# 24. Definition of "Good AI Code"

Cursor-generated code is considered good only if:

✔ follows architecture
✔ is fully typed
✔ is testable
✔ is mock-compatible
✔ has no hidden logic
✔ does not bypass any layer

---

# 25. Failure Conditions

Cursor output is INVALID if it:

❌ breaks architecture flow
❌ introduces AWS SDK outside providers
❌ merges engine + plugin logic
❌ skips testing requirements
❌ removes separation of concerns
❌ creates new unapproved layers

---

# 26. Final Instruction to Cursor AI

> Always assume the architecture is correct. Your job is to implement it, not question it.

If something is unclear:

✔ ask for clarification
✔ do NOT improvise architecture changes

---

# 27. Final Statement

Cursor AI is a **precision implementation tool** in SISU'M.

It is not allowed to:

* redesign the system
* simplify architecture by merging layers
* bypass constraints for convenience

It must operate strictly within the defined system boundaries.

---

# End of Cursor AI Guidelines
