# Git Workflow Standard

**Project:** SISU'M Cloud Optimization Decision Platform
**Version:** 1.0
**Status:** Sprint 0 Foundation Document

---

# 1. Purpose

This document defines the **Git workflow rules** for all engineers and AI-assisted development (Cursor AI included).

It ensures:

* stable collaboration between 3 engineers
* clean history of changes
* safe production releases
* traceable feature development
* prevention of broken main branch

---

# 2. Core Git Philosophy

> The main branch is always production-safe.
> No exceptions.

Every change must be:

* isolated
* reviewed
* tested
* traceable

---

# 3. Branch Structure

## 3.1 Permanent Branches

```text id="git_main"
main        → production-ready code
develop     → integration branch
```

---

## 3.2 Temporary Branches

```text id="git_features"
feature/*
bugfix/*
hotfix/*
docs/*
refactor/*
```

---

## 3.3 Naming Convention

### Features

```text id="feature_naming"
feature/ec2-plugin
feature/governance-engine
feature/workflow-orchestrator
```

### Bug Fixes

```text id="bugfix_naming"
bugfix/evidence-validation-error
```

### Documentation

```text id="docs_naming"
docs/api-spec-update
```

### Refactoring

```text id="refactor_naming"
refactor/engine-structure-cleanup
```

---

# 4. Workflow Strategy

## 4.1 Standard Flow

```text id="workflow_flow"
feature branch
    ↓
pull request
    ↓
code review
    ↓
CI validation
    ↓
merge into develop
    ↓
integration testing
    ↓
merge into main
```

---

## 4.2 No Direct Commits Rule

❌ Direct commits to `main`
❌ Direct commits to `develop`

✔ All changes must go through Pull Requests

---

# 5. Pull Request Rules

Every PR must:

✔ Be small and focused
✔ Solve one problem only
✔ Be linked to a task or backlog item
✔ Include tests
✔ Include documentation updates (if needed)

---

## 5.1 PR Title Format

```text id="pr_title"
type(scope): short description
```

### Examples:

* `feat(ec2): add instance evidence collector`
* `fix(governance): correct approval logic`
* `docs(api): update workflow endpoints`

---

## 5.2 PR Description Must Include

* What changed
* Why it changed
* How it was tested
* Screenshots/logs (if relevant)
* Linked task

---

# 6. Code Review Rules

Every PR must be reviewed by at least **1 engineer** (preferably 2 for core modules).

---

## 6.1 Review Focus Areas

✔ Architecture compliance
✔ Engine/plugin separation
✔ AWS provider isolation
✔ Test coverage
✔ Logging correctness
✔ Error handling

---

## 6.2 Reviewer Responsibilities

Reviewers must NOT approve if:

* AWS SDK is used outside provider
* tests are missing
* architecture rules are violated
* logic is unclear or duplicated

---

# 7. Merge Rules

## 7.1 Merge to `develop`

Allowed when:

✔ PR approved
✔ CI passes
✔ Tests pass

---

## 7.2 Merge to `main`

Allowed only when:

✔ Full integration tested
✔ No critical bugs
✔ Release is stable
✔ Tech Lead approves

---

# 8. CI/CD Requirements

Every PR must pass:

✔ Lint checks
✔ TypeScript compilation
✔ Unit tests
✔ Integration tests (if applicable)

---

# 9. Commit Standards

## 9.1 Commit Message Format

```text id="commit_format"
type(scope): description
```

---

## 9.2 Commit Types

| Type     | Meaning            |
| -------- | ------------------ |
| feat     | New feature        |
| fix      | Bug fix            |
| refactor | Code restructuring |
| docs     | Documentation      |
| test     | Testing            |
| chore    | Maintenance        |

---

## 9.3 Good Examples

✔ `feat(engines): add financial impact calculator`

✔ `fix(provider): correct EC2 response mapping`

✔ `docs(security): update IAM rules`

---

## 9.4 Bad Examples

❌ `fixed stuff`
❌ `update code`
❌ `wip`
❌ `final final fix`

---

# 10. Branch Lifecycle Rules

## 10.1 Feature Branch Lifecycle

```text id="branch_lifecycle"
create branch
    ↓
implement feature
    ↓
add tests
    ↓
open PR
    ↓
review
    ↓
merge
    ↓
delete branch
```

---

## 10.2 Branch Deletion Rule

✔ All merged branches must be deleted
✔ Stale branches must be cleaned weekly

---

# 11. Conflict Resolution Rules

When conflicts occur:

✔ Prefer architecture correctness
✔ Prefer newer engine structure
✔ Resolve in feature branch (not main)
✔ Discuss with Tech Lead for core modules

---

# 12. Hotfix Rules

Hotfixes are ONLY for production issues.

Flow:

```text id="hotfix_flow"
main
    ↓
hotfix branch
    ↓
fix
    ↓
test
    ↓
merge into main + develop
```

---

# 13. Release Strategy

Releases are controlled via:

* tagged commits
* versioning

Example:

```text id="release_tag"
v1.0.0
v1.1.0
```

---

# 14. Versioning Strategy

Follow Semantic Versioning:

```text id="semver"
MAJOR.MINOR.PATCH
```

| Type  | Meaning          |
| ----- | ---------------- |
| MAJOR | Breaking changes |
| MINOR | New features     |
| PATCH | Bug fixes        |

---

# 15. Repository Protection Rules

Protected branches:

* main
* develop

Rules:

✔ No direct push
✔ PR required
✔ CI must pass
✔ Review required

---

# 16. Collaboration Rules (3 Engineers)

## Team:

* Mpho (Tech Lead)
* Obianuju (Frontend / Integration)
* Florence (Backend / Providers)

---

## 16.1 Ownership Rule

Each engineer:

✔ Owns their domain
✔ Must not overwrite another engineer's module
✔ Must coordinate changes via PR

---

## 16.2 Shared Responsibility Areas

* Orchestrator (Mpho + Florence)
* Shared types (All)
* Documentation (All)

---

# 17. AI / Cursor Git Rules

Cursor AI MUST:

✔ Follow branch naming conventions
✔ Never commit directly to main
✔ Always generate feature branches
✔ Follow PR structure
✔ Avoid large uncontrolled changes

---

# 18. Anti-Patterns (STRICTLY FORBIDDEN)

❌ Committing directly to main
❌ Large PRs mixing multiple features
❌ "Final fix" commits
❌ Force pushing to shared branches
❌ Unreviewed merges
❌ Missing test PRs

---

# 19. Definition of Clean Git State

A repository is considered clean when:

✔ main is deployable
✔ develop is stable
✔ no unreviewed PRs exist
✔ all branches follow naming rules
✔ CI is green

---

# 20. Final Principle

> Git is not just version control — it is the history of how your system evolved.

Bad Git = unmaintainable system
Good Git = scalable engineering organization

---

# End of Git Workflow Standard
