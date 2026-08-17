# Sprint 2 — Governance Convergence Intelligence

## Status

Proposed (Sprint 2)

## Owner

Engineer 2

## Scope

Determines whether the governance/security posture of one EC2 resource,
for one existing check, is being preserved, improving, replaced, or missing
across repeated analysis runs — using the EC2 security/governance findings
that already exist (`backend/engines/ec2-security`,
`backend/cloud-intelligence/ec2-security`), not a parallel scanner.

Out of scope: wiring this engine into the live
`Ec2SecurityAnalysisOrchestrator` run loop, and any new HTTP API surface.
The orchestrator and its findings model are untouched by this PR — see
"No weakening of existing security rules" below. Both are natural,
low-risk follow-ups once this engine has been reviewed: the reuse adapter
(`governance-evidence-reuse.ts`) is designed to consume exactly the
`Ec2SecurityAnalysisResult` the orchestrator already computes per run.

## Frozen contract (Task 1)

```ts
interface GovernanceConvergenceAssessment {
  state: 'PRESERVED' | 'IMPROVED' | 'REPLACED' | 'MISSING';
  reasonCodes: string[];
  previousEvidenceId?: string;
  currentEvidenceId?: string;
  evaluatedAt: string;
  ruleVersion: string;
}
```

Exactly these four `state` values — no free-form or additional
classification. `ruleVersion` is this engine's own classification-rule
version (`GOVERNANCE_CONVERGENCE_RULE_VERSION`), distinct from the
underlying EC2 security analyzer's `EC2_SECURITY_RULE_VERSION`, which is
carried separately on each evidence observation.

## Decision table (Task 2)

`satisfied` is three-valued: `true` (compliant), `false` (violating), or
`undefined` (evaluated but evidence was insufficient to determine
compliance — never coerced to `false`, per "do not equate absence of
evidence with compliance").

| Prior | Current | Mechanism (fingerprint) | State | Reason |
| --- | --- | --- | --- | --- |
| any | same as prior | unchanged | **PRESERVED** | `CONTROL_STILL_SATISFIED` (both `true`) / `VIOLATION_PERSISTS_UNCHANGED` (both `false`) / `EVIDENCE_UNAVAILABLE_UNCHANGED` (both `undefined`) |
| `false` | `true` | changed | **IMPROVED** | `VIOLATION_RESOLVED` |
| `undefined` | `true` | changed | **IMPROVED** | `MECHANISM_STRENGTHENED` |
| `true` | `true` | changed (e.g. `ruleVersion` bump) | **REPLACED** | `MECHANISM_CHANGED_STILL_SATISFIED` |
| `true` | `false` | changed | **REPLACED** | `CONTROL_REGRESSED` |
| `undefined`/`true`/`false` | `undefined` | changed | **REPLACED** | `VIOLATION_CONTENT_CHANGED` |
| — | (no current evidence at all) | — | **MISSING** | `CURRENT_EVIDENCE_ABSENT` |
| (no prior evidence at all) | any | — | *(no result — see below)* | — |

### Engineering decisions

- **REPLACED covers two conceptually different transitions**: "a different
  mechanism now governs an unchanged-outcome control" (`ruleVersion`
  changed, `satisfied` unchanged) and "the same mechanism now produces a
  worse outcome" (`true → false`, `CONTROL_REGRESSED`). Both are grouped
  under REPLACED rather than inventing a fifth state, consistent with the
  Sprint 1 precedent
  ([sprint-1-evidence-governance-mapping.md](./sprint-1-evidence-governance-mapping.md))
  that REPLACED means "current evidence supersedes previous evidence"
  without implying deletion — not narrowly "mechanism identity changed."
  `reasonCodes` disambiguates the two without widening the frozen `state`
  enum. `CONTROL_REGRESSED` is the highest-value signal this engine
  produces and is never folded into PRESERVED.
- **PRESERVED includes an unchanged violation**, not only unchanged
  compliance. "Preserved" is read as "unchanged," and the reason code
  (`VIOLATION_PERSISTS_UNCHANGED`) always tells the caller which case
  applied — the raw `evidence.satisfied` value is never hidden.
- **A true first sighting (no prior evidence at all) produces no
  convergence result.** `assessGovernanceConvergence` returns `null` rather
  than inventing a state outside the frozen four; the underlying evidence
  observation is still recorded (Task 3), so a comparison becomes possible
  on the next run. This is different from MISSING, which requires a prior
  observation to exist and describes its absence *this* run.
- **MISSING is never produced by comparing two evidence snapshots** — it is
  produced by `buildMissingEvidenceAssessment`, called only when a control
  that had prior evidence produces no current evidence at all this run. A
  snapshot whose *evidence quality* degrades (e.g. security-group evidence
  becomes insufficient) is REPLACED, not MISSING — evidence is still
  present, just less certain. MISSING is reserved for genuine absence.

## Persistence (Task 4)

Two record types, both stored append-only in the existing shared
`SisumCloudResourcesTable` (`CLOUD_RESOURCES_TABLE_NAME`) — no new table or
GSI, following the Sprint 1 precedent:

1. **`GovernanceEvidenceObservationRecord`** (Task 3) — the raw,
   longitudinal evidence log. One row per analysis run per
   (resource, check), written only when evidence was actually produced.
   Idempotent on `(tenantId, accountId, findingKey, analysisRunId,
   observationTimestamp)` via the same conditional-put pattern as
   `DynamoDbEvidenceObservationRepository`.
2. **`GovernanceConvergenceResultRecord`** (Task 4) — the durable
   classification, extending `GovernanceConvergenceAssessment` with
   `resultId`, tenant/account/resource/check identity, `findingKey`,
   `analysisRunId`, and `persistedAt`. Produced whenever a classification
   is made (PRESERVED/IMPROVED/REPLACED alongside a new observation, or
   MISSING via `recordMissingEvidence`), answering "what governance
   evidence was compared to reach this conclusion" directly from one row.

Ownership resolution (`resolveOwnerTenantId`) is pure parsing — the
`findingKey` embeds `tenantId` as its first `#`-delimited segment (segment
values are validated to exclude `#`, so the split is unambiguous) — no
separate ownership-index write or read is needed.

## Reusing existing findings (Task 3)

`governance-evidence-reuse.ts` maps Task 2's eight named EC2
governance/security signals onto the exact `check` identifiers the
existing analyzer (`engines/ec2-security/ec2-security.analyzer.ts`)
already produces:

| Task 2 signal | Existing `check` identifier |
| --- | --- |
| Required tags | `required_tags` |
| Name-tag policy | `naming_standard` |
| EBS encryption | `ebs_encryption` |
| Public IP exposure | `public_ip_exposure` |
| SSH exposure | `unrestricted_ssh` |
| IAM instance profile | `iam_instance_profile` |
| Backup policy evidence | `backup_policy` |
| Monitoring configuration | `cloudwatch_monitoring` |

`deriveGovernanceEvidenceFromFindings` takes the `securityFindings` +
`governanceFindings` arrays already produced by one analysis run
(`Ec2SecurityAnalysisResult`) and derives `satisfied` per tracked check.
Absence of a direct finding means "evaluated and passed" **except** when
one of the existing evidence-insufficiency markers
(`insufficient_security_group_evidence`,
`insufficient_ebs_encryption_evidence`, added by
`ec2-security-evidence.ts`'s `supplementAnalysisForInsufficientEvidence`)
is present for a gated check — in that case `satisfied` is `undefined`,
never inferred as `true`. This is the concrete mechanism for "do not
equate absence of evidence with compliance."

## Tenant isolation (Task 5)

Every read is scoped by `(tenantId, accountId)` partition key plus an
explicit `tenantId` equality check on returned items (defense in depth
against a key-construction bug), matching the pattern used throughout this
codebase's DynamoDB repositories. `findingKey` embedding `tenantId`
structurally prevents cross-tenant collision even under a hypothetical
`accountId` reuse.

## No weakening of existing security rules

This PR adds no changes to `Ec2SecurityAnalysisOrchestrator`,
`ec2-security.analyzer.ts`, `Ec2SecurityFindingRepository`, or any
existing finding's `status`/`severity` semantics. The only touched
existing file is `database/cloud-resources/index.ts` (one new barrel
export line).
