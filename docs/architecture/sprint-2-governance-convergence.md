# Sprint 2 — Governance Convergence Intelligence

## Status

Implemented (Sprint 2, Engineer 2).

**CURRENT:** `PRESERVED`, `IMPROVED`, `REPLACED`, and live `MISSING` are
operational through EC2 security analysis when eligibility guards pass.

**APPROVED POLICY:** Strict evidence-only MISSING + lifecycle separation —
see [`adr-int-03-governance-convergence-missing-semantics.md`](./adr-int-03-governance-convergence-missing-semantics.md).

## Owner

Engineer 2

## Scope

Determines whether the governance/security posture of one EC2 resource,
for one existing check, is being preserved, improving, replaced, or missing
across repeated analysis runs — using the EC2 security/governance findings
that already exist (`backend/engines/ec2-security`,
`backend/cloud-intelligence/ec2-security`), not a parallel scanner.

HTTP read APIs for convergence history remain out of scope. The live
production integration point is the existing EC2 security analysis path.

## Live production integration (current behavior)

After EC2 security findings are persisted successfully,
`Ec2SecurityAnalysisOrchestrator` invokes `GovernanceConvergenceService`
(additive, optional dependency):

```text
EC2 Security Analyzer (analyzeEc2Security)
        ↓
Existing security/governance findings per instance
        ↓
deriveGovernanceEvidenceFromFindings()
        ↓
GovernanceConvergenceRepository.recordObservation()
        ↓
Comparison against chronological prior observation
        ↓
PRESERVED / IMPROVED / REPLACED
        ↓
Latest checkpoint upsert (GOVERNANCE_CONVERGENCE_LATEST)
        ↓
If authoritative: reconcile live MISSING via latest checkpoints
        ↓
Deterministic convergence result persistence
```

Live `MISSING` uses `recordMissingEvidence()` internally when a prior checkpoint
exists, the resource is `ACTIVE`, discovery + security proof passes for the
region, the control was expected for an analyzed instance, and no current
observation was produced (excluding technical persistence failures and
`satisfied = undefined` insufficiency).

Wiring:

- `backend/cloud-intelligence/ec2-security/ec2-security-analysis-orchestrator.ts`
- `backend/services/governance-convergence-service.ts`
- `backend/services/ec2-security-analysis-api-service.ts`
- `backend/services/ec2-async-job-consumer-factory.ts`
- `backend/index.ts`

Technical convergence failures add warnings and do **not** roll back or
invalidate successful security finding persistence.

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
| any | same as prior | unchanged | **PRESERVED** | `GOVERNANCE_CONTROL_STILL_SATISFIED` (both `true`) / `GOVERNANCE_VIOLATION_PERSISTS_UNCHANGED` (both `false`) / `GOVERNANCE_EVIDENCE_UNAVAILABLE_UNCHANGED` (both `undefined`) |
| `false` | `true` | changed | **IMPROVED** | `GOVERNANCE_VIOLATION_RESOLVED` |
| `undefined` | `true` | changed | **IMPROVED** | `GOVERNANCE_MECHANISM_STRENGTHENED` |
| `true` | `true` | changed (e.g. `ruleVersion` bump) | **REPLACED** | `GOVERNANCE_MECHANISM_CHANGED_STILL_SATISFIED` |
| `true` | `false` | changed | **REPLACED** | `GOVERNANCE_CONTROL_REGRESSED` |
| `undefined`/`true`/`false` | `undefined` | changed | **REPLACED** | `GOVERNANCE_VIOLATION_CONTENT_CHANGED` |
| — | (no current evidence at all) | — | **MISSING** | `GOVERNANCE_CURRENT_EVIDENCE_ABSENT` |
| (no prior evidence at all) | any | — | *(no result — see below)* | — |

### Passed control vs MISSING

For tracked checks the analyzer evaluates every run, absence of a direct
violation finding means **evaluated and passed** (`satisfied = true`) unless
an insufficiency gate is active. A corrected violation (`false → true`) is
**IMPROVED**, never MISSING.

**MISSING** is produced by live reconciliation (via `recordMissingEvidence()`)
when prior checkpoint evidence exists, eligibility guards pass, and current
authoritative observation is genuinely absent. It does not infer MISSING from
passed controls, corrected violations, analyzer failures, or `satisfied = undefined`.

Resource lifecycle events (`NOT_SEEN`, `STALE`, termination), out-of-scope
regions, and partial/failed discovery or security runs **never** trigger live
MISSING — see
[`adr-int-03-governance-convergence-missing-semantics.md`](./adr-int-03-governance-convergence-missing-semantics.md).

### Current EC2 adapter limitation

Reconciliation machinery is integrated, but the current EC2 evidence adapter
always derives `true | false | undefined` for all eight tracked controls on
every analyzed ACTIVE instance. Insufficiency uses `undefined`, not absence.
Genuine live MISSING is therefore **supported by infrastructure** but **not
naturally produced** by today's adapter during ordinary successful runs.

Integration tests that emit MISSING use a test-only
`shouldRecordCurrentObservation()` override to simulate absence — not ordinary
production evidence behavior.

### Insufficient evidence

When `insufficient_security_group_evidence` or
`insufficient_ebs_encryption_evidence` is present, gated checks record
`satisfied = undefined`. This is never treated as compliance and never
automatically converted to MISSING. Evidence-quality degradation between runs
is classified by the engine (typically **REPLACED**), not MISSING.

## Persistence (Task 4)

Three record roles in the existing shared `SisumCloudResourcesTable`
(`CLOUD_RESOURCES_TABLE_NAME`) — no new table or GSI, following the Sprint 1
precedent:

1. **`GovernanceEvidenceObservationRecord`** — append-only raw evidence log.
2. **`GovernanceConvergenceResultRecord`** — append-only durable classification.
3. **`GovernanceLatestObservedControlRecord`** — mutable latest-state checkpoint
   per `(tenant, account, region, resource, check)` for bounded MISSING
   reconciliation. SK prefix `GOVERNANCE_CONVERGENCE_LATEST#`. Does not replace
   or mutate historical observation/result rows. Advancement ordering:
   `observationTimestamp` then `latestLogicalObservationId` (see
   `observation-ordering.ts`).

### Observation logical identity

Derived from:

```text
tenantId + accountId + findingKey + analysisRunId + observationTimestamp
```

DynamoDB SK:
`GOVERNANCE_CONVERGENCE_OBSERVATION#FK#{findingKey}#TS#{observationTimestampIso}#LOG#{logicalObservationId}`

### Result logical identity (observation-backed)

Derived from:

```text
tenantId + accountId + findingKey + currentLogicalObservationId + GOVERNANCE_CONVERGENCE_RULE_VERSION
```

DynamoDB SK:
`GOVERNANCE_CONVERGENCE_RESULT#FK#{findingKey}#TS#{sourceObservationTimestampIso}#LR#{logicalResultId}`

### Result logical identity (MISSING)

Derived from:

```text
tenantId + accountId + findingKey + analysisRunId + GOVERNANCE_CONVERGENCE_RULE_VERSION + MISSING
```

DynamoDB SK:
`GOVERNANCE_CONVERGENCE_RESULT#FK#{findingKey}#EVT#{analysisRunId}#LR#{logicalResultId}`

Partition key for both entity types:
`cloudResourceAccountPartitionKey(tenantId, accountId)`.

### Duplicate and concurrent behavior

- Exact logical observation replay: one observation row; convergence result
  recovered if missing (`created: false`, result returned when reconstructable).
- Exact logical MISSING replay: one MISSING result row.
- Concurrent writers of the same logical result: conditional put + deterministic
  get; exactly one durable row.

### Partial-write recovery

If observation persistence succeeds but result persistence fails, a retry of
the same logical observation:

1. loads the existing observation;
2. returns the existing result if present;
3. otherwise re-evaluates against the chronological predecessor and persists
   the missing result under deterministic identity.

Historical convergence results are never rewritten.

### Out-of-order evidence

Late-arriving observations compare against their true chronological
predecessor (`findRelevantPreviousObservation`). Already-persisted convergence
results remain immutable snapshots of the evaluation made at that logical event.

### Provenance

Observation-backed results persist tenant/account/region/resource/check,
`findingKey`, previous/current evidence IDs, `currentLogicalObservationId`,
`analysisRunId`, `ruleVersion`, and `evaluatedAt`. Compliant controls may
legitimately have no `sourceFindingId` because passed controls produce no
violation finding. MISSING results persist previous evidence reference only;
current evidence reference remains absent by definition.

## Reusing existing findings (Task 3)

`governance-evidence-reuse.ts` maps eight named EC2 governance/security
signals onto the exact `check` identifiers the existing analyzer already
produces:

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
`governanceFindings` arrays already produced by one analysis run and derives
`satisfied` per tracked check.

## Tenant isolation (Task 5)

Every read is scoped by `(tenantId, accountId)` partition key plus an
explicit `tenantId` equality check on returned items. `findingKey` embeds
`tenantId` as its first `#`-delimited segment.

## No weakening of existing security rules

Governance convergence is additive intelligence. EC2 security analyzer rules,
finding status lifecycle, severity semantics, and scoring are unchanged.
Orchestrator wiring catches convergence failures and surfaces them as
warnings without invalidating durable security findings.
