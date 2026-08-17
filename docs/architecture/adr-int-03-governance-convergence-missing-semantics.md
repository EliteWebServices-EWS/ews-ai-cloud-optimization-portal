# ADR-INT-03: Live EC2 governance convergence MISSING semantics

## Status

**APPROVED: Strict evidence-only MISSING + lifecycle separation**

Human architecture decision recorded August 2026. Live MISSING reconciliation
is implemented on branch `fix/sprint-2-governance-convergence-completion`
using:

- explicit `isAuthoritativeForGovernanceAbsence()` predicate
- bounded latest-observed checkpoint registry (`GOVERNANCE_CONVERGENCE_LATEST`)
- append-only historical observations/results unchanged
- no DynamoDB Scan, no new table, no GSI

## Approved policy summary

Live `MISSING` is emitted only when **all** are true:

- resource lifecycle status = `ACTIVE`
- tenant/account match
- resource region is in authoritative current-run scope
- discovery completed successfully for that region
- security analysis completed successfully (`SUCCEEDED`) for the run
- control is one of the eight tracked governance controls
- prior governance observation exists (via latest checkpoint)
- current governance observation was expected for an analyzed instance
- no current governance observation was produced
- absence is not caused by evidence insufficiency (`satisfied = undefined`)
- absence is not caused by provider/API failure or partial analysis
- absence is not caused by technical persistence failure

**Never automatic MISSING:** `NOT_SEEN`, `STALE`, terminated/deleted equivalent,
out-of-requested-region resources, failed/partial discovery or security runs,
insufficient evidence (`undefined`), passed controls, corrected violations,
technical observation persistence failures.

## Implementation (approved)

| Component | Location |
| --- | --- |
| Authority predicate | `backend/governance-convergence/governance-convergence-authority.ts` |
| Latest checkpoint keys | `backend/database/cloud-resources/governance-convergence-keys.ts` |
| Checkpoint repository API | `upsertLatestObservedControl`, `listLatestObservedControls` |
| Live reconciliation | `GovernanceConvergenceService.reconcileLiveMissingEvidence()` |
| Orchestrator wiring | discovery proof via `getLatestSuccessfulRun()`, security status, active inventory |

### Checkpoint identity

```text
PK = TENANT#{tenantId}#AWS_ACCOUNT#{accountId}
SK = GOVERNANCE_CONVERGENCE_LATEST#REGION#{region}#RESOURCE#{resourceId}#CHECK#{check}
```

Historical `GOVERNANCE_CONVERGENCE_OBSERVATION` and `GOVERNANCE_CONVERGENCE_RESULT`
rows remain append-only/immutable. Checkpoint items are mutable latest-state only.

### Failure ordering

```text
security findings persist
  → current governance observations persist
  → latest checkpoints update
  → if run/scope authoritative: reconcile live MISSING
  → complete governance convergence processing
```

Technical persistence failures are tracked and excluded from MISSING reconciliation.

### Checkpoint ordering

Latest checkpoint advancement uses the same canonical ordering as historical
observations (`observation-ordering.ts`):

```text
observationTimestamp ascending
then latestLogicalObservationId lexicographic
```

Equal-timestamp candidates for the same resource/check therefore converge to
one deterministic winner regardless of worker arrival order. DynamoDB upserts
use conditional puts on timestamp and logicalObservationId — not last-write-wins
by arrival order.

### Current EC2 adapter limitation

**CURRENT:** reconciliation infrastructure, authority guards, bounded checkpoint
registry, and deterministic `recordMissingEvidence()` semantics are integrated.

**CURRENT EC2 ADAPTER LIMITATION:** for every analyzed `ACTIVE` instance,
`deriveGovernanceEvidenceFromFindings()` always produces a snapshot
(`satisfied = true | false | undefined`) for all eight tracked controls.
Insufficiency is represented as `undefined`, not as absence. Therefore a genuine
expected-but-unobserved control gap is **not naturally generated** by the
current EC2 security adapter during ordinary successful runs.

If all eligibility conditions are met and a current observation is genuinely
absent, reconciliation will emit `MISSING`. Tests that simulate absence use a
test-only override of `shouldRecordCurrentObservation()` — this is **not**
ordinary production evidence behavior.

## Context (historical)

Sprint 2 Engineer 2 implemented governance convergence with the frozen
four-state contract (`PRESERVED`, `IMPROVED`, `REPLACED`, `MISSING`).
The live EC2 security path operationalizes `PRESERVED`, `IMPROVED`, and
`REPLACED` through `Ec2SecurityAnalysisOrchestrator` →
`GovernanceConvergenceService` → `deriveGovernanceEvidenceFromFindings()` →
`recordObservation()`.

`MISSING` is implemented at repository/service level via
`recordMissingEvidence()` with deterministic identity and idempotency, but
the orchestrator does **not** invoke it automatically.

A mandatory semantic checkpoint (August 2026) concluded:

```text
LIVE MISSING CHECKPOINT STOPPED — CONTRACT/ARCHITECTURE DECISION REQUIRED
```

### What the existing code already proves

| Layer | Behavior |
| --- | --- |
| Comparison engine | `assessGovernanceConvergence()` never emits MISSING. |
| Missing assessment | `buildMissingEvidenceAssessment()` applies only when prior evidence existed but **no current evidence was produced this run**. |
| Live path | For every instance in `analysis.results`, all eight tracked checks always receive a derived snapshot (`satisfied = true \| false \| undefined`). |
| Discovery lifecycle | `ACTIVE`, `NOT_SEEN`, `STALE` on `DiscoveredCloudResourceRecord`. |
| Security lifecycle | OPEN findings may be RESOLVED when absent from a successful run scope; this is separate from convergence MISSING. |

### The unresolved question

> Under what exact conditions should live EC2 governance evidence be
> classified as **MISSING**?

---

## Semantic matrix (cases A–J)

Current repository/engine behavior and checkpoint findings. **No live
auto-inference exists today** unless a future policy explicitly adds it.

| Case | Description | Current behavior | Proposed default for live auto-MISSING (pending decision) |
| --- | --- | --- | --- |
| **A** | Resource remains `ACTIVE`; control expected; authoritative current evidence genuinely absent | **Cannot occur** in live path today — adapter always returns a snapshot for in-scope analyzed instances. Would require a new per-control "not derivable" signal distinct from `undefined`. | **Only valid MISSING trigger** under Option 1 (once signal + guards exist). |
| **B** | Resource becomes `NOT_SEEN` after successful discovery | Discovery sets `NOT_SEEN` when absent from successful scope (`ec2-discovery-orchestrator.ts`). Security still loads `NOT_SEEN` records via `listResourcesInScope()` (no lifecycle filter). | **Not MISSING** — lifecycle signal, not evidence-quality signal (Option 1 / 3). |
| **C** | Resource becomes `STALE` | Lifecycle status on inventory record; EC2 Cost ignores `STALE` for analysis. Security does not filter `STALE`. | **Not MISSING** — treat as lifecycle/out-of-authority (Option 1 / 3). |
| **D** | Resource known terminated/deleted | Represented as `NOT_SEEN` after successful discovery; no separate tombstone convergence state. | **Not MISSING** — termination is resource lifecycle, not governance evidence disappearance (Option 1 / 3). |
| **E** | Resource outside current requested region scope | Not in `input.regions`; no observation written this run. Prior observations may exist. | **Not MISSING** — out-of-scope by definition (matches security finding resolution guard). |
| **F** | Discovery succeeded in some regions but failed in others | `Ec2DiscoveryRunRecord.regionsSucceeded` / `regionsFailed`. Security run has no equivalent fields; convergence does not consult discovery proof. | **Not MISSING** — run not authoritative for absence inference until eligibility predicate exists. |
| **G** | Security analysis `PARTIAL` | `Ec2SecurityAnalysisRunRecord.status = PARTIAL`. Convergence currently runs without status guard. | **Not MISSING** — partial run cannot prove evidence absence (Sprint 1 I-12 precedent). |
| **H** | Security analysis `FAILED` | Run failed; findings may be incomplete. | **Not MISSING** — failed collection must not invent convergence states. |
| **I** | Evidence insufficient: `satisfied = undefined` | Observation recorded; engine classifies change as **REPLACED** when fingerprint changes, not MISSING. | **Not MISSING** — explicit three-valued semantics. |
| **J** | Control passed: `satisfied = true` | Compliant evaluation; may yield **PRESERVED** or **IMPROVED**. | **Not MISSING** — passed control is never absence. |

---

## Candidate policies

### Option 1 — Strict evidence-only MISSING

**Policy:** Emit live MISSING only when **all** are true:

```text
resource.status === ACTIVE
AND resource.region ∈ requestedRegions
AND discoveryRun.status === SUCCEEDED for that region
AND securityRun.status === SUCCEEDED
AND resource/control authoritatively in scope
AND control was expected this run
AND no current governance evidence observation was produced
AND absence is not explained by satisfied = undefined insufficiency alone
AND absence is not explained by lifecycle (NOT_SEEN / STALE / terminated)
```

**Benefits**

- Aligns with Sprint 2 evidence-first philosophy and `GOVERNANCE_CURRENT_EVIDENCE_ABSENT`.
- Avoids false MISSING on termination, partial runs, and insufficient evidence.
- Auditable: each predicate is inspectable from run/resource provenance.
- Tenant-safe: scoped to requested regions and authoritative runs only.

**Limitations**

- Requires a **new authoritative signal** that a control was expected but not
  derivable while the resource remains in scope (today's adapter never returns
  "absent").
- Requires **run-completeness guards** not yet wired into convergence.
- Requires a **bounded way to know which prior finding keys expected reconciliation**
  (see access-pattern section).

**Recommendation candidate:** **RECOMMENDED — NOT YET APPROVED**

---

### Option 2 — Resource disappearance counts as MISSING

**Policy:** If a `(tenant, account, region, resource, check)` had a prior
governance observation and the resource is absent from the current
authoritative inventory (or successful discovery scope), emit MISSING for all
eight tracked checks.

**Benefits**

- Operationally simple narrative: "we used to see governance evidence; now we
  don't."
- Can detect disappearance without a new per-control derivability signal.

**Risks**

- **Conflates lifecycle disappearance with evidence disappearance.**
  Terminated/deleted resources (`NOT_SEEN`) would produce MISSING convergence
  history that reads like governance regression.
- **False positives** when region scope narrows, discovery is partial, or
  security run is incomplete.
- **Passed-control history** for removed resources would generate eight MISSING
  rows per run — noisy and expensive.
- Conflicts with Sprint 1 I-12: partial/failed collection must not be mistaken
  for clean absence.

**Recommendation candidate:** **Rejected** for live auto-inference unless product
explicitly accepts termination-as-MISSING semantics.

---

### Option 3 — Separate lifecycle semantics (architectural separation)

**Policy:** Keep convergence **MISSING** strictly for governance evidence
absence (Option 1 predicates). Represent resource disappearance through
existing inventory lifecycle:

```text
ACTIVE → NOT_SEEN → (optional future STALE handling)
```

and/or security finding lifecycle (OPEN → RESOLVED), **without** mapping
`NOT_SEEN` to convergence MISSING. Do **not** add a fifth convergence enum.

**Benefits**

- Clean separation: lifecycle vs evidence quality vs convergence classification.
- Reuses existing discovery and security semantics auditors already understand.
- Avoids overloading MISSING with resource deletion narratives.

**Implications**

- Operators review `NOT_SEEN` inventory and security RESOLVED findings for
  resource removal; convergence MISSING remains a narrower evidence signal.
- Future UI/reporting may correlate lifecycle + convergence without merging states.
- Live MISSING still requires Option 1 prerequisites (signal + guards + access pattern).

**Recommendation candidate:** **Accepted as complementary framing** to Option 1
(lifecycle is not MISSING), not a standalone implementation.

---

## Recommended policy

**Option 1 (Strict evidence-only MISSING) + Option 3 (lifecycle separation)**

Mark: **`RECOMMENDED — NOT YET APPROVED`**

Rationale:

1. Matches Sprint 2 engine/repository contract (`buildMissingEvidenceAssessment`
   requires prior evidence and zero current evidence — not lifecycle change alone).
2. Preserves three-valued evidence semantics (`undefined` ≠ MISSING).
3. Aligns with Sprint 1 I-12 fail-safe collection rules.
4. Avoids inferring governance regression on legitimate resource termination.
5. Keeps tenant/account/region scope explicit and auditable.

**Human owner must approve** before any live MISSING implementation.

---

## Authoritative-run eligibility (conceptual)

Before live MISSING may ever be inferred, define a predicate ( **not implemented** ):

```text
isAuthoritativeForGovernanceAbsence(input) → boolean
```

### Inputs

| Input | Source | Role |
| --- | --- | --- |
| `tenantId`, `accountId` | Security run | Tenant scope |
| `requestedRegions` | Security run `regions[]` | Scope boundary |
| `discoveryRun.status` | Latest linked discovery run | Overall discovery outcome |
| `discoveryRun.regionsSucceeded` | Discovery run | Per-region authority |
| `discoveryRun.regionsFailed` | Discovery run | Exclude failed regions |
| `securityRun.status` | Security run | Must be `SUCCEEDED` |
| `securityRun.instancesFound` | Security run | Inventory loaded |
| `securityRun.instancesAnalyzed` | Security run | Analyzer coverage |
| `resource.status` | `DiscoveredCloudResourceRecord` | Must be `ACTIVE` for absence inference |
| `resource.region` | Inventory | Must ∈ `requestedRegions` |
| `providerWarnings` | Discovery/security warnings | Must not indicate failed evidence collection for the control |
| `priorObservationExists` | Governance repo | Required for MISSING |
| `currentObservationProduced` | Convergence service | Must be false for the `(resource, check)` |

### Expected truth conditions (all required)

```text
securityRun.status === 'SUCCEEDED'
AND discoveryRun.status ∈ {'SUCCEEDED'} OR requested region ∈ discoveryRun.regionsSucceeded
AND resource.status === 'ACTIVE'
AND resource.region ∈ requestedRegions
AND priorObservationExists(findingKey) === true
AND currentObservationProduced(findingKey) === false
AND NOT explainedByInsufficientEvidenceGate(check)
AND NOT outOfScopeRegion(resource.region, requestedRegions)
```

If any condition is false → **do not emit MISSING** (remain silent or emit diagnostic only).

---

## Resource lifecycle contract (current implementation)

| Status | Set by | Meaning (current code) | Convergence participation (proposed) |
| --- | --- | --- | --- |
| `ACTIVE` | Discovery upsert when resource seen | Resource returned in successful discovery scope for the region. | **Participate** — eligible for observation-backed convergence. |
| `NOT_SEEN` | `markNotSeen()` after successful discovery scope when previously ACTIVE resource absent from API results | Resource not seen in last successful discovery of that scope — **likely terminated/removed**, not "evidence missing while resource exists." | **Exclude from MISSING inference**; handle via inventory lifecycle. Security currently still analyzes `NOT_SEEN` rows — a separate hygiene decision. |
| `STALE` | Reserved lifecycle value on model | Treated as non-analyzable by EC2 Cost; meaning less exercised in security path. | **Exclude from MISSING inference**; lifecycle/out-of-authority. |

Implementation references:

- `backend/repositories/models/cloud-resource-persistence-models.ts`
- `backend/cloud-intelligence/orchestration/ec2-discovery-orchestrator.ts`
- `backend/repositories/dynamodb/dynamodb-ec2-cloud-resource-repository.ts` (`markNotSeen`)

---

## Access-pattern alternatives (future — not implemented)

FindingKey-scoped reads (`listObservationsForFinding`, `getLatestResult`) are
bounded but **cannot discover orphan prior keys** without knowing `findingKey`
in advance.

### A. Account-history enumeration

```text
PK = TENANT#{tenantId}#AWS_ACCOUNT#{accountId}
Query begins_with(SK, GOVERNANCE_CONVERGENCE_OBSERVATION#)
```

| Aspect | Assessment |
| --- | --- |
| DynamoDB Scan? | No — partition Query |
| Growth | **Unbounded** with account lifetime (every run × 8 checks × instances) |
| Cost | Every reconciliation may paginate full history |
| Duplicate keys | Logical idempotency prevents duplicate observations; history still grows |
| Verdict | **Rejected** for routine live MISSING reconciliation |

### B. Latest-observed finding-key registry (current-state item)

One deterministic current-state record per `(tenant, account, region, resource, check)` pointing to latest observation/result.

| Aspect | Assessment |
| --- | --- |
| Lookup | **Bounded** O(1) per key |
| Writes | Extra upsert on each observation; must stay consistent with append-only log |
| History | Observations remain append-only |
| Verdict | **Recommended** future pattern if live MISSING is approved |

### C. Per-resource checkpoint

Single item per `(tenant, account, region, resource)` listing eight check presence timestamps or bitset.

| Aspect | Assessment |
| --- | --- |
| Lookup | Bounded per resource |
| Writes | Simpler than per-check registry but coarser reconciliation |
| Verdict | Acceptable variant of B; prefer B for check-level precision |

### D. Existing inventory / security finding repositories

| Provides | Cannot provide |
| --- | --- |
| Current resource IDs and lifecycle status per region | Which tracked **passed** controls had prior governance observations |
| OPEN/RESOLVED **violation** findings | Compliant-control observation history |
| Discovery run regional success/failure | Orphan prior finding keys without enumeration |

**Recommended future access pattern:** **Option B** (latest-observed registry) +
Option 1 eligibility predicate. Reject Option A for production reconciliation loops.

---

## Consequences (implemented)

- Live MISSING reconciliation runs through `GovernanceConvergenceService` after
  checkpoint updates when discovery + security proof is complete.
- Reconciliation is wired for checkpoint gaps with full eligibility guards.
- The current EC2 adapter still derives all eight tracked snapshots for every
  analyzed ACTIVE instance, so genuine absence is **architecturally supported**
  but **not naturally reachable** today without a future per-control omission
  signal or changed evidence source.
- Repository `recordMissingEvidence()` remains the durable write path with
  deterministic identity and idempotency.

## Related

- `docs/architecture/sprint-2-governance-convergence.md`
- `docs/architecture/sprint-1-evidence-governance-mapping.md` (I-12 partial/failed collection)
- `backend/governance-convergence/governance-convergence-engine.ts`
- `backend/services/governance-convergence-service.ts`
- `backend/repositories/contracts/governance-convergence-repository.ts`
