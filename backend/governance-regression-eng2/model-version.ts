/**
 * Sprint 4 Governance Regression & Unsafe-State Release Blocking.
 *
 * This module is a READ-ONLY release-qualification pass over the outputs
 * already produced by the Sprint 1-3 authoritative engines
 * (EvidenceMaturity, GovernanceConvergence, ConfidenceAssessment,
 * DecisionReadiness, MLDecision, ActionPolicy, Approval, Verification,
 * RollbackAuthorization). It does not compute readiness, governance,
 * approval, or execution eligibility itself, and it must never be wired as
 * a second source of those decisions at runtime. Its only outputs are:
 *
 *   - which canonical safety invariants (if any) a decision snapshot
 *     violates,
 *   - which impossible/contradictory state combinations (if any) exist in
 *     the snapshot, and
 *   - a deterministic release-qualification verdict: SAFE, BLOCKED, or
 *     INSUFFICIENT_EVIDENCE.
 *
 * See docs/architecture/adr-int-14-governance-regression-safety-gate.md.
 */
export const GOVERNANCE_REGRESSION_POLICY_VERSION = 'governance-regression-v1';
