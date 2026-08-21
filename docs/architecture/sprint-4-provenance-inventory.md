# Sprint 4 Provenance Inventory

Audit date: 2026-08-21
Branch: `feature/sprint-4-provenance-reconstruction`

## Files inspected

| Area | Paths |
|------|-------|
| ActionLog core | `backend/action-log/types.ts`, `lifecycle-context.ts`, `event-identity.ts`, `event-ordering.ts`, `stage-adapters.ts`, `record-builder.ts`, `action-log-emitter.ts` |
| ActionLog service | `backend/services/action-log-service.ts`, `action-log-repository-factory.ts` |
| ActionLog persistence | `backend/repositories/contracts/action-log-repository.ts`, `dynamodb/dynamodb-action-log-repository.ts`, `mock/mock-action-log-repository.ts`, `database/execution/action-log-keys.ts`, `persistence/action-log-pagination-scopes.ts` |
| Intelligence evidence | `repositories/contracts/evidence-observation-repository.ts`, `evidence-maturity-repository.ts`, `governance-convergence-repository.ts` |
| Execution | `execution-plan-repository.ts`, `execution-run-repository.ts`, `execution-history-repository.ts`, `models/execution-persistence-models.ts` |
| Verification | `engines/verification/verification.repository.ts`, `post-action-verification/*`, `repositories/contracts/verification-repository.ts` |
| ML / policy / audit | `ml-decision/`, `action-policy/`, `audit/audit-query.ts` |
| Learning | `repositories/contracts/learning-repository.ts`, `engines/learning/dynamodb-learning.repository.ts` |
| Retention | `persistence/retention.ts` |
| ADRs / Sprint 3 docs | `adr-int-06`, `adr-int-08`, `sprint-3-action-log.md`, verification release gate docs |

## Inventory classification

| Concept | Status | Authoritative repository | Primary identity | Tenant scope | Account scope | Decision/correlation linkage | ActionLog linkage | sourceRecordId semantics | sourceRecordVersion | Durable | Retention/TTL | Deterministic reconstruction | Log-only gaps |
|---------|--------|-------------------------|------------------|--------------|---------------|------------------------------|-------------------|-------------------------|---------------------|---------|---------------|------------------------------|---------------|
| ActionLog | **PRESERVED** | `DynamoDbActionLogRepository` / `MockActionLogRepository` on `sisum-execution-plans` | `logicalEventId` | `tenantId` partition | Optional `accountId` on event | `decisionId`, `correlationId`, `executionId` index rows | Self | Upstream stage record id | Model/policy version when emitted | Yes | **No TTL in code** (ADR-INT-06 notes policy TBD) | Yes — Query + ordering | None for lifecycle skeleton |
| EvidenceObservation | **PRESERVED** | DynamoDB cloud-resources repo | Logical observation id (`analysisRunId` + `observationTimestamp`) | Required on all reads | Required | Via `findingKey` + workflow/correlation in callers | `RECOMMENDATION_OBSERVED`, `PERSISTENCE_EVALUATED` refs | Observation logical id | Observation/schema version | Yes | Not in `retention.ts` (table-level TBD) | Partial — needs findingKey + account | None material |
| PersistenceAssessment | **PRESERVED** | Same as evidence observation pipeline | Observation logical id | Required | Required | findingKey path | `PERSISTENCE_EVALUATED` | Assessment source id | Model version | Yes | Not centralized | Partial | None |
| EvidenceMaturity | **PRESERVED** | `EvidenceMaturityRepository` | `(findingKey, sourceLogicalObservationId, modelVersion)` | Required | Required | findingKey | `MATURITY_EVALUATED` | Maturity assessment id | `modelVersion` | Yes | Not in `retention.ts` | Partial | None |
| GovernanceConvergence | **PRESERVED** | `GovernanceConvergenceRepository` | Logical observation / result ids | Required | Required | findingKey | `GOVERNANCE_EVALUATED` | Observation or result id | Model version | Yes | Not in `retention.ts` | Partial | None |
| ConfidenceAssessment | **PRESERVED** | Confidence engine persistence (via evidence services) | Assessment record id | Required | Required | findingKey | `CONFIDENCE_EVALUATED` | Source assessment id | Model version | Yes | Not centralized | Partial | None |
| MLDecision | **PRESERVED** | ActionLog references only (no separate ML decision table) | ML run id in `sourceRecordId` | Required on emit | Required on emit | correlationId | `ML_*` events | ML decision id | Policy/model version | Reference durable in ActionLog; payload not duplicated | N/A | Yes via ActionLog refs | ML rationale detail only in emit-time logs if not referenced |
| ActionPolicy | **PRESERVED** | Evaluation is inline; durable outcome via ActionLog + execution plan | Policy evaluation id in ActionLog | Required | Required | correlationId | Approval/execution events | Plan or policy eval id | Policy version | Outcome durable | N/A | Yes | None |
| Approval | **PRESERVED** | `ExecutionPlanRepository` (`approvalStatus`, history) | `executionId` | Required | Implicit via plan tenant | workflowId / executionId | `APPROVAL_*` events | `executionId` | Plan version | Yes | Workflow window 90d (`WORKFLOW_RETENTION_SECONDS`) | Yes when plan retained | None |
| ExecutionPlan | **PRESERVED** | `ExecutionPlanRepository` | `executionId` | Required | Not stored on plan record | workflowId | `EXECUTION_*` / approval events | `executionId` | Plan version | Yes | Workflow-linked | Yes | None |
| ExecutionRun | **PRESERVED** | `ExecutionRunRepository` | `runId` | Required | resource context in record | correlationId | Optional execution refs | run id | Version | Yes | Not in retention.ts | Partial | None |
| ExecutionHistory | **PRESERVED** | `ExecutionHistoryRepository` append-only | `historyId` | Required | Via execution | executionId | Complements ActionLog | history row id | N/A | Yes | Same table as plans | Partial | None |
| VerificationResult | **PRESERVED** | Engine `VerificationRepository` + generic verification repo | `executionId` / workflowId | Required | Optional `accountId` on engine output | workflowId, executionId | `VERIFICATION_*` | executionId | Assessment version | Yes | 180d (`VERIFICATION_RETENTION_SECONDS`) | Yes when record retained | None |
| PostActionVerificationAssessment | **PRESERVED** | Composed on engine `VerificationOutput.assessment` | Same as verification | Required | Required when scoped | executionId | `VERIFICATION_*` | executionId | Sprint 3 assessment version | Yes | 180d with verification | Yes | None |
| Cost evidence | **PRESERVED** | EC2 cost repos / recommendation payloads | Recommendation / cost summary ids | Required | Required | findingKey / recommendation | `RECOMMENDATION_OBSERVED` reason codes | Cost record id | Version when emitted | Yes | Report 180d where applicable | Optional stage | None |
| Learning records | **PRESERVED** | `LearningRepository` | `learningId` | Required | workflow scope | workflowId | Optional `RECOMMENDATION_DECIDED` | learningId | Version | Yes | 365d (`LEARNING_RETENTION_SECONDS`) | Optional stage | None |
| Audit events | **PRESERVED** (non-authoritative for reconstruction) | Audit query persistence | `eventId` | Required | Optional resource fields | correlationId, workflowId | Complements ActionLog | audit event id | schemaVersion | Yes | 365d default | Not used for lifecycle reconstruction | Operational detail may be log-enriched |
| correlationId | **PRESERVED** | ActionLog index + upstream records | Stable workflow correlation string | Required | N/A | Primary lifecycle key | Indexed | N/A | N/A | Yes | Varies by source record | Yes | None |
| decisionId | **PRESERVED** | ActionLog decision index | Explicit or derived `{correlationId}#{findingKey}#{recommendationId}` | Required | With account on resource events | Primary decision key | Indexed | N/A | N/A | Yes | ActionLog no TTL | Yes | None |
| workflowId | **PRESERVED** | Workflow repository | workflowId | Required | Account binding in workflow | Links execution/verification | On ActionLog events | N/A | N/A | Yes | 90d workflow retention | Partial after TTL | None |
| jobId | **PRESERVED** | EC2 async job repo | jobId | Required | Account scoped | Async analysis | Optional on ActionLog | job id | N/A | Yes | Job table TTL TBD | Partial | None |
| executionId | **PRESERVED** | Execution plan / verification | executionId | Required | Account verified at reconstruction | Links execution + verification | Indexed | Primary execution ref | Plan version | Yes | Workflow window | Yes | None |
| sourceRecordId | **PRESERVED** | ActionLog field | Per-stage authoritative id | Tenant on read | Account verified | Points to upstream durable row | Self | Stage-specific | N/A | Reference | Follows source TTL | Yes — availability checked | None |
| sourceRecordVersion | **PRESERVED** | ActionLog field | Version string | Tenant on read | When applicable | Policy/model lineage | Self | Version semantics per stage | Yes | Follows source | Yes | None |
| Rollback assessment / execution | **MISSING** (advisory only Sprint 3) | Verification advisory signals only | N/A | Required | Required | executionId | No dedicated rollback ActionLog stages yet | N/A | N/A | Partial | Verification 180d | No full rollback reconstruction | Rollback execution not implemented |
| Provenance reconstruction read model | **EXTEND** | New `DecisionProvenanceReconstructionService` | `(tenantId, accountId, decisionId\|correlationId)` | Required | Required verified | Loads ActionLog + resolves refs | Uses ActionLog | References only | Collected from events | Read model only | N/A | **New Sprint 4** | None |

## Material log-only gaps

| Gap | Impact |
|-----|--------|
| CloudWatch / Lambda logs | Operational only — not used for reconstruction |
| ML detailed rationale | Durable pointer in ActionLog; full payload not stored unless referenced |
| Rollback execution lifecycle | ADR-INT-08 advisory only — no durable rollback execution stage |
| ActionLog retention policy | Not defined in `retention.ts`; ActionLog rows have no `expiresAt` in repository code |

## Retention risks

1. **ActionLog without TTL** vs **verification 180d** / **workflow 90d** — ActionLog may outlive source records; reconstruction reports `PROVENANCE_SOURCE_RECORD_UNAVAILABLE` and degrades completeness.
2. **Workflow 90d** vs **learning 365d** — asymmetric windows can leave learning without workflow context.
3. **Evidence on cloud-resources** — no central constant in `retention.ts`; table template must be consulted for production TTL.
4. **False COMPLETE** prevented by completeness evaluator when required sources are `UNAVAILABLE`.

## Architecture ambiguities

1. ActionLog retention policy intentionally deferred in ADR-INT-06 — Sprint 4 documents invariant in ADR-INT-09, does not make all records permanent.
2. Two verification repository interfaces (engine vs generic) — reconstruction uses engine `findByExecutionId` when injected.
3. Rollback lifecycle completeness codes reserved (`PROVENANCE_ROLLBACK_MISSING`) for future rollback execution work.

## Proposed Sprint 4 files

| File | Purpose |
|------|---------|
| `backend/provenance-reconstruction/*` | Contract, ordering, completeness, source resolution |
| `backend/services/decision-provenance-reconstruction-service.ts` | Bounded reconstruction orchestration |
| `backend/tests/fixtures/sprint-4-provenance/provenance-fixtures.ts` | Golden vectors |
| `backend/tests/unit/provenance-reconstruction-*.test.ts` | Contract, retention, repository safety |
| `backend/tests/integration/sprint-4-provenance-reconstruction.test.ts` | Service + isolation |
| `docs/architecture/adr-int-09-decision-data-retention-evidence-lineage.md` | Retention ADR |
| `docs/architecture/sprint-4-provenance-reconstruction.md` | Architecture doc |

## Expected tests

- Golden vectors: COMPLETE (executed, no-ML, simulation, rollback), PARTIAL (cost, learning), INCOMPLETE (approval, verification)
- Late arrival ordering by `occurredAt`
- Duplicate ActionLog dedupe by `logicalEventId`
- Tenant/account isolation fail-closed
- No Scan repository behavior
- Retention constant documentation
