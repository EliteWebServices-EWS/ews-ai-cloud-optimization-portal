# EWS / SISU'M Enterprise Handbook

This directory contains the **living engineering handbook** for the **EWS AI Cloud Optimization Platform** (internal platform name: **SISU'M**).

The handbook documents what the platform has actually built, how it is architected, how it is secured, what is planned next, and how engineering changes must stay aligned with evidence-driven optimization principles.

## Contents

| Document | Purpose |
|----------|---------|
| [ENTERPRISE-HANDBOOK.md](./ENTERPRISE-HANDBOOK.md) | Main living enterprise engineering handbook — architecture, security, persistence, async intelligence, execution, gaps, sprints, and target state |

## Core engineering principle

> **Evidence before intelligence.**
> **Governance before action.**
> **Verification before success.**
> **History before learning.**
> **Human control before autonomy.**

## Intelligence convergence programme (next four sprints)

Sequential dependency — each sprint requires the prior release gate:

1. **Evidence Foundation + Persistence** (Sprint 1)
2. **Evidence Maturity + Governance + Confidence** (Sprint 2) — requires Sprint 1
3. **ML Safe Degradation + Controlled Action Lifecycle** (Sprint 3) — requires Sprint 1 and Sprint 2; no production-authoritative ML until those gates pass
4. **Verification + Rollback + Provenance + Enterprise Release Qualification** (Sprint 4) — requires Sprint 3

## Documentation rule

**The repository documentation must describe the actual implemented system.**

When implementation changes materially, update the relevant documentation in the same engineering change.

Do **not** document planned behaviour as implemented behaviour.

Status labels used in the handbook:

- **CURRENT** — substantiated by repository code, tests, or infrastructure definitions
- **PARTIALLY IMPLEMENTED** — present but incomplete, mock-default, or split across paths
- **PLANNED** — specified in architecture/roadmap but not present in code
- **PROPOSED** — target design for future sprints
- **NOT VERIFIED** — claimed operationally but not fully proven by automated validation

## Related documentation (outside this directory)

Existing architecture, validation, security, and operations documentation remains under `docs/architecture/`, `docs/security/`, `docs/validation/`, and `docs/operations/`. This handbook **does not replace** those documents; it consolidates the enterprise view and links to them where useful.
