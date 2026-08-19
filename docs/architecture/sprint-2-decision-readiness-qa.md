# Sprint 2 — Decision Readiness QA (Engineer 4)

## Objective

Prove Sprint 2 operates as one deterministic, tenant-isolated decision-intelligence pipeline:

```text
Observation → Persistence → Evidence Maturity → Governance Convergence → Evidence-Aware Confidence → Decision Readiness
```

Engineer 4 owns canonical fixtures, cross-module integration proof, failure/degradation QA, tenant isolation QA, and the Sprint 2 decision-readiness contract.

## Domain-separated architecture boundary (approved)

EC2 **cost** persistence/maturity/confidence and EC2 **security** governance convergence remain separate production paths.

- Cost evidence uses explicit EC2 cost `findingKey` (`buildEc2CostFindingKey`).
- Governance convergence uses explicit security/governance `findingKey` (`buildGovernanceConvergenceFindingKey`).
- **Never** derive canonical finding identity from `resourceId` alone.
- Sprint 2 decision-readiness accepts an explicit governance convergence context supplied by the authoritative governance contract or an approved correlation adapter — it does not infer governance from cost observations.

## Decision-readiness contract (`decision-readiness-v1`)

Module: `backend/decision-readiness/`

| Field | Source |
| --- | --- |
| Persistence | Authoritative Sprint 1 observation assessment via `ConfidenceEvidenceService` |
| Maturity | Authoritative persisted maturity via `ConfidenceEvidenceService` |
| Governance convergence | Explicit `DecisionReadinessGovernanceConvergenceContext` input |
| Confidence | Frozen Engineer 3 engine (`calculateConfidence`) |
| Readiness | Conservative deterministic policy in `readiness-policy.ts` |

### READY semantics

`READY` is an **evidence/decision-readiness state only**.

```text
Evidence READY ≠ Approved ≠ Executed
```

READY must **not** grant approval, create execution plans, invoke AWS-changing execution, or bypass governance. Sprint 3 owns approval/action policy.

### v1 READY gates (all required)

- Validation valid
- Longitudinal evidence composed successfully
- Persistence `STABLE`
- Maturity `MATURE`
- Confidence status `HIGH`
- Governance context available
- Governance convergence state not `MISSING`

`IMPROVED` and `REPLACED` convergence states are acceptable for READY when context is available.

## Bounded confidence evidence lookup (Engineer 4 prerequisite)

Before production hot-path wiring, `ConfidenceEvidenceService` uses bounded repository access:

| Path | Method |
| --- | --- |
| Latest observation | `EvidenceObservationRepository.getLatestObservationForFinding` |
| Explicit logical identity | `getObservationByLogicalId` when `sourceAnalysisRunId` + `sourceObservationTimestamp` supplied |

DynamoDB implementation: scoped Query, `ScanIndexForward: false`, `Limit: 1`. No Scan. Mock/DynamoDB parity tested.

## Canonical fixtures

Root: `backend/tests/fixtures/evidence/`

Sprint 2 aliases in `decision-readiness-scenarios.ts`:

| Alias | Maps to |
| --- | --- |
| `MATURE_STABLE` | `buildPersistentRecommendationScenario()` |
| `PARTIAL_STABLE` | First two persistent observations |
| `IMMATURE_NEW` | `buildNewRecommendationScenario()` |
| `CHANGED_RECOMMENDATION` | `buildChangedRecommendationScenario()` |
| `MISSING_HISTORY` | `buildMissingPreviousScenario()` |
| `GOVERNANCE_*` | Explicit convergence context builders |
| Confidence inputs | `buildHealthyEvidence()` + production engine output (no forced score) |

Fixtures provide **source inputs**; production services produce assessed outputs.

## Integration tests

| Suite | Purpose |
| --- | --- |
| `sprint-2-decision-readiness-golden.test.ts` | Golden readiness scenarios |
| `sprint-2-decision-readiness-failures.test.ts` | Failure/degradation matrix |
| `sprint-2-decision-readiness-tenant-isolation.test.ts` | Cross-tenant/account isolation |

Release gate script: `npm run test:sprint2-decision-readiness`

## Known limitations

- **Production caller for `ConfidenceEvidenceService`:** intentionally deferred per `sprint-2-confidence-engineer-handoff.md` until an approved production composition point is defined; Sprint 2 gate requires deterministic integration proof only.
- Production orchestrator wiring for `DecisionReadinessService` is QA-only in Sprint 2; no HTTP/API surface.
- Cross-domain governance correlation is explicit-input only in v1.
- `sourceObservationId` without logical identity resolves against latest observation only; mismatch yields no composed evidence.

## Sprint 3 handoff

- Production caller/composition seam for `ConfidenceEvidenceService` and cost-path readiness
- Approval/action policy separate from readiness
- Optional unified correlation envelope if product requires single cross-domain key
