# ADR: Sprint 11 engine repository adapter boundary

## Status

Accepted (temporary)

## Context

Sprint 11 introduced two DynamoDB access layers:

1. **Contract repositories** under `backend/repositories/dynamodb/` — normalized records, GSIs, optimistic locking, and paginated list APIs used by the workflow orchestrator.
2. **Engine adapters** under `backend/engines/*/dynamodb-*.repository.ts` — envelope-style items (`data` blobs), report/learning query helpers, and cross-table ownership writes used by reporting, learning, and verification engines.

Both layers now share:

- conditional ownership writes (`ensureEngineOwnership`, `SAME_OWNER_CONDITION`);
- bounded pagination (`PersistenceTable.queryPageByPrefix`, scoped tokens);
- transactional multi-item writes where a logical unit spans multiple keys/tables;
- append-only history keys (`timestamp#uuid`).

## Decision

Keep engine adapters for Sprint 11 hardening to limit blast radius. Consolidate cross-cutting persistence mechanics in `backend/persistence/*` and ownership contracts in `backend/repositories/contracts/ownership-repository.ts`.

Full merge of engine adapters into contract repositories is deferred until Sprint 12 planning confirms API stability requirements.

## Consequences

- Single production write path per entity remains a Sprint 12 follow-up.
- Tests must cover both adapter behavior and shared persistence utilities.
- Migration and operations documentation reference engine key layouts explicitly.
