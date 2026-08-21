# ADR-INT-06: Longitudinal ActionLog Persistence

## Status

Accepted — Sprint 3 Engineer 1 foundation

## Context

SISU'M requires deterministic reconstruction of the decision lifecycle across intelligence, approval, execution, and verification stages. Existing mechanisms partially overlap:

- **Audit events** — operational/security trail with `correlationId`
- **Execution history** — execution plan lifecycle append-only rows
- **Evidence / maturity / governance stores** — stage-specific append-only assessments on `sisum-cloud-resources`
- **Verification records** — workflow/execution indexed outputs

No unified ActionLog module existed. CloudWatch logs are useful for operations but are not durable, query-bounded lifecycle storage.

## Decision

Introduce a dedicated **ActionLog** append-only entity family on the existing **`sisum-execution-plans`** table:

1. **Canonical row** keyed by `logicalEventId` for idempotent writes.
2. **Query index rows** under the same tenant partition for correlation, decision, execution, and account/resource bounded Query paths.
3. **Thin service** validating identity and delegating to repository — no decision recomputation.
4. **Deterministic ordering** on `(occurredAt, orderKey, logicalEventId)` with separate `recordedAt`.
5. **Repair-on-retry projection writes** so partial failures cannot leave canonical rows without required query indexes.
6. **`ActionLogEmitter`** boundary for authoritative stage outputs (Sprint 1/2 wired where seams are stable).

We explicitly **do not** replace audit, execution history, or verification repositories. ActionLog complements them with cross-stage provenance references.

### Identity (v1)

- `logicalEventId` identifies the logical domain occurrence (default SHA-256 includes `correlationId`).
- `eventId` identifies the stored ActionLog row; v1 intentionally sets `eventId === logicalEventId`.

### Failure semantics (v1)

Authoritative upstream writes succeed independently. ActionLog persistence failures throw `ActionLogPersistenceError` and are retryable/idempotent — upstream results are never recomputed or rolled back.

## Alternatives considered

| Alternative | Outcome |
|-------------|---------|
| New DynamoDB table | Rejected — unnecessary cost/complexity; execution-plans already hosts append-only history |
| Store ActionLog on cloud-resources | Rejected — wrong partition model for execution/approval lifecycle |
| CloudWatch subscription index | Rejected — not authoritative or bounded |
| Single SK only (correlation) | Rejected — insufficient for decision/execution/resource reconstruction without Scan |

## Consequences

### Positive

- Bounded Query reconstruction for decision, resource, correlation, and execution lifecycles
- Idempotent event identity safe for SQS retries
- Clear boundary vs audit/execution history
- Ready for Engineer 2/3/4 emitters via stable contract

### Negative / trade-offs

- Multiple index rows per event (write amplification)
- Stage emitters must populate `correlationId` and source references explicitly
- Retention policy not finalized in Sprint 3

### Sprint 4 extension (Engineer 1)

Sprint 4 adds **decision provenance reconstruction** as a read model over ActionLog + authoritative repositories (`DecisionProvenanceReconstructionService`). ActionLog remains the single longitudinal index; reconstruction dedupes, orders, resolves source availability, and classifies completeness without creating ActionLogV2 or recomputing historical decisions. See `docs/architecture/sprint-4-provenance-reconstruction.md` and ADR-INT-09.

## Compliance with intelligence programme

- Does **not** rewrite Sprint 1 persistence or Sprint 2 maturity/governance/confidence/readiness engines
- Does **not** implement ML safe-degradation, approval policy, or verification redesign
- Preserves tenant/account scoping and scoped pagination token conventions

## References

- `docs/architecture/sprint-3-action-log.md`
- `docs/handbook/ENTERPRISE-HANDBOOK.md` §22 Longitudinal ActionLog
- `backend/repositories/dynamodb/dynamodb-execution-history-repository.ts` (append-only precedent)
