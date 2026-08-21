# Sprint 4 — Governance Regression Audit (Engineer 2)

Branch: `feature/sprint-4-governance-regression`

## Objective

Qualification/regression layer over existing Sprint 1–4 authoritative components. **No duplicate governance engines.**

## Component inventory

| Component | Classification | Authoritative location | Notes |
|-----------|----------------|------------------------|-------|
| EvidenceMaturity | **PRESERVED** | `backend/evidence-maturity/` | Evaluator + service; maturity `MATURE`/`PARTIAL`/`IMMATURE` |
| GovernanceConvergence | **PRESERVED** | `backend/governance-convergence/` | Sprint 2 frozen states; `MISSING` = governance failure for readiness |
| Legacy GovernanceDecision | **PRESERVED** | `backend/engines/governance/` | Workflow engine; `POLICY_STATUS.FAIL` optional slice in qualification |
| ConfidenceResult | **PRESERVED** | `backend/engines/confidence/` | No `ConfidenceAssessment` type — uses `ConfidenceResult` |
| DecisionReadiness | **PRESERVED** | `backend/decision-readiness/` | `evaluateSprint2DecisionReadiness()` — READY ≠ APPROVED |
| MLDecision | **PRESERVED** | `backend/ml-decision/` | Summarized at Action Policy boundary via `MlDecisionSummary` |
| ActionPolicy | **PRESERVED** | `backend/action-policy/` | Pure `evaluateActionPolicy()` — ML non-authority |
| Approval | **PRESERVED** | Execution plan + Action Policy + API | `ExecutionPlanRecord.approvalStatus` |
| Approval override governance | **EXTEND** | Sprint 4 override on execution API | Governed override + ActionLog `APPROVAL_OVERRIDDEN` |
| ExecutionPlan / ExecutionRun | **PRESERVED** | `backend/repositories/models/` | Lifecycle in `execution-lifecycle.ts` / orchestrator |
| Verification (legacy comparator) | **PRESERVED** | `backend/engines/verification/` | Comparator only — not enterprise assessment |
| PostActionVerificationAssessment | **PRESERVED** | `backend/post-action-verification/` | `HEALTHY` ≠ `RESOLVED`; `ROLLBACK_CANDIDATE` advisory |
| Rollback advisory | **PRESERVED** | ADR-INT-08 + post-action outcomes | Advisory signal only |
| Rollback execution | **MISSING** (partial) | `execution-orchestrator.rollbackRun()` | Privileged API boundary exists; durable ActionLog rollback stages deferred (Engineer 4) |
| Provenance reconstruction | **PRESERVED** | `backend/provenance-reconstruction/` | Sprint 4 Engineer 1; source-verified qualification separate |
| Governance regression qualification | **EXTEND** (new) | `backend/governance-regression/` | Release qualification only — not runtime governance |

## Overlapping / contradictory state combinations (documented)

| Combination | Risk | Sprint 4 handling |
|-------------|------|-------------------|
| `IMMATURE` maturity + `READY` readiness | False production readiness | `GOVERNANCE_CONTRADICTION_IMMATURE_WITH_READY` → BLOCKED |
| Governance failure + `READY` readiness | Stale/contradictory historical row | `GOVERNANCE_CONTRADICTION_GOVERNANCE_FAIL_WITH_READY` → BLOCKED |
| Governance failure + execution `ELIGIBLE` | Unsafe production path | `GOVERNANCE_CONTRADICTION_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE` → BLOCKED |
| `NOT_READY` + execution `ELIGIBLE` | Bypass readiness gate | `GOVERNANCE_CONTRADICTION_NOT_READY_EXECUTION_ELIGIBLE` → BLOCKED |
| ML `EXECUTED` claimed as authority | ML authority leak | `GOVERNANCE_CONTRADICTION_ML_EXECUTED_IS_AUTHORITY` → BLOCKED |
| Governance failure + ML authority claim | ML weakens governance | `GOVERNANCE_CONTRADICTION_ML_OVERRIDES_GOVERNANCE_FAIL` → BLOCKED |
| HIGH confidence → APPROVED | Approval bypass | `GOVERNANCE_CONTRADICTION_HIGH_CONFIDENCE_IMPLIES_APPROVED` → BLOCKED |
| Approval required + `NOT_REQUIRED` status | Approval integrity gap | `GOVERNANCE_CONTRADICTION_APPROVAL_REQUIRED_NOT_REQUIRED` → BLOCKED |
| Execution without approval | Unsafe terminal state | `GOVERNANCE_CONTRADICTION_MISSING_APPROVAL_EXECUTION` → BLOCKED |
| Rejected approval + execution | Unsafe terminal state | `GOVERNANCE_CONTRADICTION_REJECTED_APPROVAL_EXECUTION` → BLOCKED |
| Stale approval + execution | Unsafe terminal state | `GOVERNANCE_CONTRADICTION_STALE_APPROVAL_EXECUTION` → BLOCKED |
| Execution API success = verified optimization | False green | `GOVERNANCE_CONTRADICTION_EXECUTION_API_SUCCESS_VERIFIED` → BLOCKED |
| `INSUFFICIENT_EVIDENCE` treated as RESOLVED | False verification | Contradiction when RESOLVED + insufficient evidence |
| `ROLLBACK_CANDIDATE` = rollback authorization | Unsafe rollback | Unauthorized/contradictory rollback authorization → BLOCKED; advisory candidate alone does not block |
| Cross-tenant scope | Isolation breach | `GOVERNANCE_CONTRADICTION_CROSS_TENANT_SCOPE` → BLOCKED |

## Legacy path classification

| Path | Classification |
|------|----------------|
| Simulation (`actionMode: SIMULATION`) | **PRESERVED_SAFE** — non-production |
| NOT_READY production policy | **FAIL_CLOSED** |
| Missing actor authorization / MFA | **FAIL_CLOSED** |
| Durable rollback ActionLog lifecycle | **DEFERRED** (Engineer 4) |
| Sprint 4 approval override with MFA + audit | **PRESERVED_SAFE** |

### Rollback candidate vs authorization

ROLLBACK_CANDIDATE is advisory and is not rollback authorization. A candidate state does not itself block an otherwise safe release; any unauthorized rollback authorization or execution is release-blocking. Qualification inspects the full snapshot — advisory candidate with sufficient context may be **SAFE**; claimed authorization without required boundary evidence is **BLOCKED**.

## Dependencies (reuse, do not duplicate)

- Sprint 2 decision readiness policy
- Sprint 3 action policy + actor gate
- Sprint 3 post-action verification assessment
- Sprint 4 provenance reconstruction (orthogonal release evidence)
- Sprint 4 approval override governance (existing tests in legacy-safety suite)

## References

- `docs/architecture/sprint-4-governance-regression.md`
- `backend/governance-regression/`
- ADR-INT-08 (rollback advisory)
- ADR-INT-13 (approval / action policy)
