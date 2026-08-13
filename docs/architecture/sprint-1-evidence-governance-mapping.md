# Sprint 1 — Evidence Governance Mapping & Decision Readiness Baseline

**Status:** Baseline complete; no production behaviour changed

**Owner:** Engineer 2

**Scope:** Commercial-control inventory and Sprint 2 decision input

**Last updated:** 2026-08-13

## Purpose and boundary

This is a read-first mapping of the research-derived evidence and governance invariants to the controls already present in EWS. It is deliberately an extension plan, not a replacement plan: useful commercial controls remain the source of truth until a later ADR explicitly supersedes them.

Sprint 1 does **not** add a `MATURE`, `PARTIAL`, or `IMMATURE` production maturity engine, alter a governance decision, change a pricing calculation, or relax approval requirements. No external research formula, weighting, or threshold has been copied into this repository.

This governance-mapping document is a commercial-control inventory and Sprint 2 ADR input. It does **not** replace the separate Engineer 1 longitudinal evidence persistence baseline documented in [sprint-1-persistence-intelligence.md](./sprint-1-persistence-intelligence.md). Likewise, the confidence scoring baseline is documented separately in [sprint-1-confidence-baseline.md](./sprint-1-confidence-baseline.md).

### Classification vocabulary

| Classification | Meaning | Sprint 1 handling |
| --- | --- | --- |
| **PRESERVED** | The commercial control implements the invariant directly. | Keep it unchanged. |
| **IMPROVED** | The commercial control is at least as protective and adds production safeguards. | Keep it; retain its stronger safeguards in later work. |
| **REPLACED** | The same governance/evidence responsibility is implemented through a materially different production mechanism for the applicable domain. This classification does **not** imply that the legacy commercial control was deleted, removed, or globally superseded. Where both mechanisms exist, they operate as parallel, domain-specific, or differently authoritative controls. | Keep all present mechanisms; define an adapter/translation only if Sprint 2 needs one. Do not remove legacy controls because a domain-specific mechanism fulfills the same responsibility elsewhere. |
| **MISSING** | No cross-platform implementation currently satisfies the invariant. | Track it as a bounded Sprint 2 decision; do not infer or implement it in Sprint 1. |

### Investigation vocabulary

Use these terms during audits and gap analysis. They are not alternate classifications for I-01 through I-14.

| Term | Meaning |
| --- | --- |
| **NOT FOUND** | A control may exist but has not yet been located in the repository after targeted investigation. Do not treat this as **MISSING** until the search is complete. |
| **NOT ESTABLISHED** | Authoritative project sources do not establish the invariant itself. Do not treat generic best practice as a project research invariant. |
| **MISSING** | The invariant is established by authoritative project sources, but no adequate commercial implementation can be verified after targeted investigation. |

### Evidence rating model

Ratings describe audit strength only. They do not change runtime behavior.

| Rating | Meaning |
| --- | --- |
| **A** | Direct implementation evidence (production code path verified) |
| **B** | Test evidence |
| **C** | Authoritative architecture or handbook documentation |
| **D** | Inference from related controls |

Do not present B, C, or D as equivalent to A. If documentation claims a control exists but executable implementation cannot be verified, record **DOCUMENTED — IMPLEMENTATION NOT VERIFIED**. If code exists but test protection cannot be verified, record **IMPLEMENTED — TEST COVERAGE NOT VERIFIED**.

## Existing commercial control inventory

| Control area | Existing implementation | Decision effect | Source of record |
| --- | --- | --- | --- |
| Telemetry | The legacy engine rejects incomplete CPU/memory telemetry; EC2 Cost collects bounded CloudWatch performance evidence and records completeness/warnings. | Incomplete evidence cannot silently become an idle finding. | `backend/engines/governance/governance.rules.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-models.ts` |
| Metrics | Legacy policy checks required metric series; EC2 Cost records expected/actual samples and completeness per instance. | Evidence can be insufficient rather than assumed healthy. | `backend/engines/governance/governance.rules.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-models.ts` |
| Observation period | Legacy governance evaluates an observation window; EC2 Cost supplies and persists a requested observation duration plus collected start/end. | A finding carries the window that produced it. | `backend/engines/governance/governance.rules.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-models.ts` |
| Candidate age | Legacy governance evaluates resource launch age; EC2 Cost and EC2 Security retain launch metadata for lifecycle/long-running review. | Young or lifecycle-sensitive resources receive a review-oriented outcome. | `backend/engines/governance/governance.rules.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-rules.ts`; `backend/engines/ec2-security/ec2-security.analyzer.ts` |
| Tags | Legacy policy requires configured tags. Discovery persists sanitized tags; Security evaluates required ownership/environment tags. | Missing governance context is a finding or governance failure, not a hidden default. | `backend/engines/governance/governance.rules.ts`; `backend/cloud-intelligence/sanitize.ts`; `backend/engines/ec2-security/ec2-security.analyzer.ts` |
| Pricing | Legacy evidence validation requires valid pricing. EC2 Cost labels rates as verified, controlled sample, or unavailable and suppresses sample values from production responses by default. | Financial estimates disclose their evidentiary status. | `backend/engines/evidence/evidence.validator.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-models.ts`; `docs/architecture/ec2-cost-intelligence.md` |
| Recommendation availability | Legacy governance treats a missing provider recommendation as advisory (`recommendationAvailableRule`). For EC2 Cost, a different authoritative mechanism produces explainable rule findings, including explicit insufficient-data findings. | No target/action is represented as insufficient data rather than an executable recommendation. | `backend/engines/governance/governance.rules.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-rules.ts` |
| Production approval | Legacy governance marks configured environments for manual approval. Durable execution plans model approval state, approver/rejector identity, and block execution until an approved state exists. | No approval-required plan can enter execution without recorded approval. | `backend/engines/governance/governance.rules.ts`; `backend/services/execution-lifecycle.ts`; `backend/repositories/models/execution-persistence-models.ts` |
| Readiness | Legacy governance maintains a readiness result separate from confidence and uses it in governance/recommendation decisions. | Evidence readiness is not conflated with confidence. | `backend/engines/governance/governance.readiness.ts`; `backend/engines/recommendation/recommendation.decision.ts` |
| Governance metadata | Policy result, approver, evidence summary, observed values, rule identity/version, finding lifecycle, and execution audit history are represented in their relevant domains. | A reviewer can determine why a decision/finding was produced and what followed it. | `backend/engines/governance/governance.engine.ts`; `backend/cloud-intelligence/ec2-cost/ec2-cost-models.ts`; `backend/repositories/models/execution-persistence-models.ts` |
| Persistence and lifecycle | Discovery, EC2 Cost runs/findings, security findings, execution plans, and append-only execution history are tenant-scoped and durable. Partial or failed Cost runs do not resolve open findings. | A failed collection cannot erase prior decision evidence. | `backend/cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator.ts`; `docs/architecture/ec2-cost-intelligence.md`; `docs/architecture/sprint-12-5-execution-plan-data-model.md` |
| Longitudinal evidence persistence (Engineer 1) | EC2 Cost appends tenant-scoped evidence observations with deterministic fingerprints, `NEW` / `STABLE` / `CHANGED` / `MISSING_PREVIOUS` assessment, evidence-first ordering, and provenance (`jobId`, `correlationId`). | EC2 recommendation intelligence is not persisted without a matching evidence observation in deployed environments; historical comparison is durable for EC2 cost findings. | `backend/persistence-intelligence/`; `backend/services/evidence-persistence-service.ts`; `docs/architecture/sprint-1-persistence-intelligence.md` |

## Governance mapping matrix

The invariants below are expressed at the decision-governance level; they intentionally do not reproduce proprietary research scoring logic.

| ID | Research-derived invariant | Commercial implementation | Gap | Classification | Engineering decision |
| --- | --- | --- | --- | --- | --- |
| I-01 | Evidence used for a decision must be retained with resource and collection context. | Durable discovery, EC2 Cost analysis runs/findings, EC2 Cost append-only evidence observations with persistence assessment, and execution plans retain resource/run context. | No single cross-domain, versioned evidence envelope links every engine; legacy workflow, EC2 Cost, Security, and execution remain separate authoritative stores. | **IMPROVED** | Preserve domain persistence and EC2 evidence observations; define a non-destructive correlation contract in Sprint 2. |
| I-02 | Missing telemetry must prevent an unsupported optimization conclusion. | Legacy high-severity telemetry policy; Cost analysis emits `INSUFFICIENT_DATA` instead of treating absent CPU data as low use. | Legacy and Cost representations are different. | **IMPROVED** | Preserve both fail-safe paths; map them to a common evidence fact later. |
| I-03 | Metrics must be sufficient for the observation being evaluated. | Legacy `requiredMetricsRule` remains present for the workflow governance path. For EC2 Cost, metric sufficiency is established through a different authoritative mechanism: CloudWatch collection completeness (`dataCompleteness`, expected/actual samples). **REPLACED** applies to the Cost domain mechanism, not deletion of the legacy rule. | No shared sufficiency vocabulary across all plugins; both mechanisms coexist. | **REPLACED** | Keep both mechanisms; Sprint 2 should normalize Cost completeness output only, not remove legacy metric validation or replace collection logic. |
| I-04 | A recommendation must state the observation period behind its evidence. | Legacy `minimumObservationWindowRule` remains present for the workflow governance path. For EC2 Cost, the observation period is carried through a different authoritative mechanism: persisted run/evidence timing metadata (requested duration, collection start/end). **REPLACED** applies to the Cost domain carrier, not deletion of the legacy window policy. | Other recommendation domains do not yet expose the same durable window fields; both mechanisms coexist where applicable. | **REPLACED** | Preserve both mechanisms and Cost run metadata; specify a reusable observation-window contract in Sprint 2. |
| I-05 | Candidate age must be considered where a new or transient resource would distort a decision. | Legacy age rule plus launch metadata consumed by Cost and Security lifecycle analysis. | Semantics differ by domain and are not centrally catalogued. | **PRESERVED** | Keep each current age guard; defer any cross-domain policy unification. |
| I-06 | Ownership/environment context must be available for governed decisions. | Configured tag checks, discovery tag sanitization/persistence, and Security tag findings. | Required tags differ by control domain. | **IMPROVED** | Preserve domain policies and sanitization; catalog required tag semantics in Sprint 2. |
| I-07 | Financial claims must identify whether pricing evidence is usable. | Evidence validation plus explicit Cost pricing status/assumptions and production sample-price suppression. | Legacy engine has less pricing provenance than Cost. | **IMPROVED** | Retain Cost disclosure controls; use them as the minimum financial-evidence contract. |
| I-08 | A decision must distinguish an actionable recommendation from an unavailable target. | Legacy `recommendationAvailableRule` remains present and produces an advisory warning when a provider hint is absent. For EC2 Cost, availability is established through a different authoritative mechanism: internal rule findings and explicit `INSUFFICIENT_DATA` outcomes. **REPLACED** applies to the Cost domain finding mechanism, not removal of the legacy provider-hint control. | Provider recommendation hints and Cost rule findings are not the same type; both mechanisms coexist. | **REPLACED** | Do not force one into the other; define an availability field that preserves source and disposition without removing either mechanism. |
| I-09 | Production-impacting changes require traceable approval before execution. | Environment approval policy plus durable approval state, approver identity, lifecycle validation, and append-only history. | Legacy governance approval is not itself the execution authorization record. | **IMPROVED** | Preserve the durable execution gate as authoritative; future maturity may inform but never bypass it. |
| I-10 | Readiness must remain separate from confidence and influence decision availability. | Legacy readiness is calculated independently and consulted before recommendation. | There is no approved cross-platform evidence-maturity taxonomy. | **PRESERVED** | Preserve current readiness behaviour; do not rename or remap it during Sprint 1. |
| I-11 | Governance metadata and rule provenance must be inspectable after a decision. | Governance policy results; Cost observed values/rule version/finding lifecycle; execution history. | Cross-domain correlation and retention ownership are not yet specified. | **IMPROVED** | Keep per-domain auditability; add correlation/retention choices to the Sprint 2 ADR. |
| I-12 | Partial/failed collection must not be mistaken for a clean result or remove prior open concerns. | Cost runs distinguish success/partial/failure and only resolve findings after an all-region successful run; Security uses a similar finding lifecycle. | Not yet formalized as a platform-wide evidence rule. | **IMPROVED** | Preserve run-status protections; make their semantics explicit in the shared contract. |
| I-13 | Each evidence-backed decision must remain tenant-scoped. | Discovery, findings, recommendations, plans, and history use tenant-scoped repository APIs and test coverage. | The legacy evidence package is workflow-scoped rather than a shared durable tenant record. | **IMPROVED** | Keep tenant boundaries; require tenant identity in any future evidence envelope. |
| I-14 | A platform-wide maturity result may summarize evidence only when its evidence and precedence are defined. | No production `MATURE` / `PARTIAL` / `IMMATURE` engine exists. Existing readiness/completeness states are domain-specific. | Required evidence, aggregation, authority, retention, and decision precedence are undecided. | **MISSING** | Track as Sprint 2 ADR input; implement nothing in Sprint 1. |

**I-14 semantic note:** **MISSING** here is an intentional Sprint 1 boundary, not an accidental production defect. The enterprise handbook defines `MATURE` / `PARTIAL` / `IMMATURE` as **PROPOSED** (Sprint 2). Sprint 1 documents required evidence, dependencies, and precedence constraints only. No proprietary research formula, threshold, or scoring algorithm has been copied into this repository.

**Coverage check:** I-01 through I-14 each have exactly one required classification. No invariant is silently discarded.

### REPLACED classification justification

For I-03, I-04, and I-08, **REPLACED** means the research-derived responsibility is fulfilled by a materially different commercial mechanism for the applicable domain, rather than by extending the original mechanism. It is **not** a deletion of the legacy commercial control and **not** platform-wide supersession.

| ID | Original/research responsibility | Legacy commercial mechanism (still present) | Domain-specific commercial mechanism | Why materially different | Why REPLACED, not IMPROVED | Legacy control still present? | What would be lost if the legacy control were actually removed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I-03 | Metrics must be sufficient for the observation being evaluated. | `requiredMetricsRule` validates generic metric/datapoint arrays in the workflow governance path. | EC2 Cost evaluates CloudWatch collection completeness (`dataCompleteness`, expected/actual samples) for Cost findings. | Generic bundle arrays versus provider-collected completeness with explicit partial/insufficient states. | Cost does not extend the legacy rule; it uses a parallel, domain-specific replacement mechanism for Cost sufficiency. | **Yes** — legacy rule remains in `governance.rules.ts`. | Workflow governance would lose direct metric-array validation for standardized evidence bundles. |
| I-04 | A recommendation must state the observation period behind its evidence. | `minimumObservationWindowRule` checks `telemetry.observationWindowDays` in the workflow governance path. | EC2 Cost persists run/evidence timing metadata (requested duration, collection boundaries) as the authoritative observation-period record for Cost findings. | Policy-time check versus durable run/evidence metadata tied to collection. | Cost does not strengthen the same check; it uses a different authoritative mechanism for the Cost domain. | **Yes** — legacy window policy remains in `governance.rules.ts`. | Workflow governance would lose the observation-window policy gate on standardized evidence. |
| I-08 | A decision must distinguish an actionable recommendation from an unavailable target. | `recommendationAvailableRule` treats a missing provider recommendation hint as an advisory warning in the workflow governance path. | EC2 Cost produces internal rule findings and explicit `INSUFFICIENT_DATA` outcomes rather than relying on provider hints. | Optional external provider hint versus internal explainable finding types. | Cost fulfills availability through its own production finding mechanism rather than extending the provider-hint control. | **Yes** — legacy advisory rule remains in `governance.rules.ts`. | Workflow governance would lose the provider-hint availability signal for standardized evidence bundles. |

## Evidence dependency map — Sprint 2 input contract

Sprint 2 should consume normalized facts and provenance, not duplicate provider calls or replace the controls above. `Required` means the fact must be present to make the named maturity assessment; it does not change existing runtime decisions until an approved ADR says so.

| Dependency | Minimum fact and provenance required | Decisions that depend on it | Current producer/control | Sprint 2 contract action |
| --- | --- | --- | --- | --- |
| Persistence | Tenant/account/resource identity; evidence/run/finding identifier; collection time; source version; lifecycle/run state; for EC2 Cost, append-only evidence observation history with fingerprint and persistence assessment. | Whether evidence is traceable, current, and safe to compare over time. | Discovery repositories; EC2 Cost run/finding records; EC2 evidence observations (`EvidenceObservationRepository`); execution plans/history. | Define correlation IDs and retention owner; do not move existing records. Legacy workflow readiness/confidence engines do not yet consume `PersistenceAssessment`. |
| Telemetry | Metric names, collected values or explicit absence, source, collection time, and completeness/warnings. | Whether utilization-derived claims are supportable. | Legacy evidence bundle; CloudWatch Cost evidence. | Normalize presence/completeness without interpreting absent telemetry as zero. |
| Pricing | Rate status, source/provenance, currency, effective date/assumptions where applicable, or explicit unavailable state. | Whether financial impact may be displayed or relied on. | Evidence validator; Cost pricing model/output policy. | Preserve distinction among verified, sample, and unavailable; no fallback-rate synthesis. |
| Recommendation availability | Source, target/action when present, and an explicit unavailable/insufficient disposition when absent. | Whether an actionable recommendation can be presented versus deferred for more data. | Provider recommendation validator; Cost rule findings. | Define a source-agnostic availability discriminator; retain source-specific detail. |
| Tags | Sanitized tag set; required-tag policy identity; missing-tag result; collection timestamp. | Ownership/environment policy application and routing. | Discovery sanitizer; legacy/EC2 Security tag policies. | Catalog policy context; never persist secret-like tag values. |
| Observation window | Start/end, requested duration, sampling period, actual/expected sample evidence, and warnings. | Whether data is temporally sufficient and comparable. | Cost performance evidence/run; legacy telemetry window. | Use facts rather than a copied formula; leave domain threshold selection to policy owners. |
| Approval | Whether approval is required; approval status; decision actor/time; plan status; rejection reason when present. | Whether execution is permitted and who can authorize it. | Governance environment rule; execution-plan lifecycle/history. | Treat the durable execution approval record as authoritative; maturity cannot approve execution. |

### Required precedence rules for the future ADR

1. An explicit missing, partial, failed, stale, or unavailable fact must never be upgraded by a maturity summary.
2. A maturity summary may advise a decision but may not override tenant isolation, pricing disclosure, policy failure, or execution approval controls.
3. Existing domain records remain authoritative for their lifecycle; any shared envelope links to them by identifier and version.
4. Maturity and confidence are separate concepts. The Sprint 2 ADR must state their consumers and precedence explicitly.

## Gap register

| Gap ID | Gap | Impact if unaddressed | Owner / next decision | Sprint 1 disposition |
| --- | --- | --- | --- | --- |
| G-01 | No shared durable evidence envelope across legacy workflow, Cost, Security, and execution domains. | Cross-domain traceability is manual. | Sprint 2 ADR: envelope boundaries and correlation strategy. | Open; no migration. |
| G-02 | No platform-wide evidence sufficiency vocabulary. | Consumers cannot compare domain states without domain knowledge. | Sprint 2 ADR: normalized facts and mappings. | Open; preserve current domain statuses. |
| G-03 | Observation-window facts are durable for Cost but not consistently represented in all domains. | Cross-plugin temporal comparison is incomplete. | Sprint 2: contract field ownership. | Open; do not retrofit data. |
| G-04 | Required-tag policies vary by governance domain. | A generic summary could misstate policy completeness. | Policy owners + Sprint 2 ADR. | Open; preserve scoped policies. |
| G-05 | Provider recommendation hints and internally derived findings have different semantics. | A single availability boolean could be misleading. | Sprint 2: typed availability/disposition model. | Open; do not coerce types. |
| G-06 | No approved `MATURE` / `PARTIAL` / `IMMATURE` taxonomy, formula, persistence model, or decision precedence. | Premature implementation could weaken commercial controls. | Sprint 2 ADR and authorized implementation plan. | Open; explicitly out of Sprint 1. |
| G-07 | Cross-domain retention and correlation ownership are not specified. | Audit queries may be incomplete or duplicate records. | Architecture/data governance owners. | Open; preserve existing retention/lifecycle rules. |

## Intentional divergence register

| Divergence | What differs and why | Is commercial control stronger? | Additional work | IP authorization required? |
| --- | --- | --- | --- | --- |
| D-01 — metric sufficiency | Research invariant requires enough evidence; legacy `requiredMetricsRule` remains present and evaluates generic metric arrays, while EC2 Cost uses a parallel domain-specific mechanism that evaluates provider-collected completeness for the requested window. This differs because production CloudWatch collection can fail or return partial data. Not a deletion of the legacy control. | Yes — for the Cost domain, it preserves collection provenance and explicit incomplete states. | Normalize fact names only; retain both domain evaluators. | No. |
| D-02 — observation evidence | The generic concept is a qualified observation period; legacy `minimumObservationWindowRule` remains present, while EC2 Cost carries observation period through persisted run-level duration and concrete collection boundaries. This differs to support operational auditability. Not a deletion of the legacy control. | Yes — for the Cost domain. | Define common window fields and provenance; preserve both mechanisms. | No. |
| D-03 — recommendation availability | Legacy `recommendationAvailableRule` remains present; a provider hint is optional in the workflow path. EC2 Cost uses a parallel domain-specific mechanism that creates advisory findings from controlled rules and represents insufficient data explicitly. This differs because a production finding is not equivalent to an external recommendation. Not a deletion of the legacy control. | Yes — for the Cost domain, it avoids inventing an action when evidence is absent. | Define typed availability/disposition; preserve both mechanisms. | No. |
| D-04 — pricing evidence | Generic pricing validation differs from Cost's explicit verified/sample/unavailable disclosure and production response policy. This differs because demo-safe catalog data must not be represented as live billing data. | Yes. | Align future envelope with status/provenance, without changing pricing sources. | No. |
| D-05 — approval authority | Legacy governance can request approval based on environment; durable execution is the authoritative approval record with actor and lifecycle controls. This differs because approval must be enforceable at the execution boundary. | Yes. | Specify how a future maturity summary references, but never replaces, execution approval. | No. |
| D-06 — readiness terminology | Existing readiness and confidence are established production concepts. `MATURE` / `PARTIAL` / `IMMATURE` is not introduced in Sprint 1 because its evidence, aggregation, and precedence are unapproved. | Not applicable; this is intentionally absent. | ADR before any implementation. | **Yes, if a later proposal requires copying or translating a proprietary research taxonomy, formula, thresholds, or decision logic.** |
| D-07 — persistence shape | Commercial persistence is domain-specific and tenant-scoped rather than a single research-shaped object. EC2 Cost additionally stores append-only evidence observations with persistence assessment, but still not a single cross-domain envelope. This differs to preserve lifecycle, concurrency, audit, and tenant controls already in production paths. | Yes. | Design a link-only envelope; no record replacement/migration without approval. | No. |

## Regression test inventory

This is a documentation-only change. The following tests protect existing controls and should remain green; no test is removed or re-baselined by this work.

| Control | Tests / command |
| --- | --- |
| Legacy evidence → governance workflow and readiness | `backend/tests/integration/workflow.orchestrator.test.ts`; `backend/tests/unit/workflow.validator.test.ts`; `backend/tests/unit/reporting.engine.test.ts` |
| EC2 Cost telemetry, observation, insufficient evidence, rule lifecycle | `npm run test:ec2-cost-intelligence` (includes `ec2-cost-orchestrator`, `ec2-cost-rules`, pricing, resolution, CloudWatch, and API suites) |
| Pricing provenance/disclosure | `backend/tests/unit/ec2-cost-pricing.test.ts`; `backend/tests/unit/ec2-cost-pricing-policy.test.ts`; `backend/tests/unit/ec2-cost-pricing-output.test.ts` |
| Tag governance, launch metadata, explicit insufficient security evidence | `npm run test:ec2-security` |
| Durable approval and execution lifecycle | `npm run test:execution-validation` |
| Tenant boundaries and approval API audit | `backend/tests/unit/tenant-isolation.test.ts`; `backend/tests/unit/execution-api-audit.test.ts`; `backend/tests/security/execution-*.test.ts` |
| EC2 longitudinal evidence persistence (Engineer 1) | `backend/tests/unit/persistence-intelligence.test.ts`; `backend/tests/unit/sprint-1-persistence-regression.test.ts`; `backend/tests/unit/mock-evidence-observation-repository.test.ts`; `backend/tests/unit/sprint-1-production-evidence-fail-closed.test.ts`; `backend/tests/integration/sprint-1-persistence-consistency.test.ts`; `backend/tests/integration/ec2-cost-evidence-persistence.test.ts`; `backend/tests/integration/sprint-1-ec2-provenance-regression.test.ts` |
| Confidence scoring baseline (PR #239) | `backend/tests/unit/confidence.scoring.test.ts`; `docs/architecture/sprint-1-confidence-baseline.md` |

## ADR input for Sprint 2 — Evidence Maturity

**Decision requested:** approve or reject a platform-level evidence-maturity capability that summarizes normalized evidence facts while preserving all existing governance and execution controls.

The ADR must decide:

1. The non-proprietary maturity vocabulary and definitions, including whether a label is presentation-only or gates any workflow.
2. The minimum evidence contract in the dependency map, fact provenance, freshness/staleness treatment, and explicit absent/partial states.
3. The authoritative producers and link-only persistence/correlation model; no destructive migration of commercial records.
4. The precedence order among policy failures, readiness, confidence, pricing status, recommendation availability, durable approval, and any future normalized persistence/maturity facts.
5. Tenant isolation, retention, audit access, and tag sanitization requirements.
6. Test fixtures for complete, partial, unavailable, stale, failed-collection, and approval-required cases.
7. Whether proposed terminology or logic derives from protected research material. If so, obtain written IP authorization before implementation; do not place the formula, thresholds, or translated logic in the repository without it.

### Engineer 1 persistence integration note

Engineer 1 longitudinal evidence persistence is **implemented for EC2 Cost** and documented in [sprint-1-persistence-intelligence.md](./sprint-1-persistence-intelligence.md). Verified behavior includes:

- append-only evidence observations on `SisumCloudResourcesTable`
- deterministic recommendation fingerprinting
- `NEW`, `STABLE`, `CHANGED`, `MISSING_PREVIOUS` assessment
- `persistence_hours` from observation timestamps
- evidence-first durable ordering with production/staging fail-closed guard
- provenance (`jobId`, `correlationId`, `analysisRunId`)
- retry/idempotency keyed by the full logical observation tuple including `observationTimestamp`

This governance mapping does **not** claim that legacy workflow governance, readiness, recommendation, or confidence engines consume `PersistenceAssessment` today. That consumption boundary remains a Sprint 2 design decision.

The confidence baseline in [sprint-1-confidence-baseline.md](./sprint-1-confidence-baseline.md) and PR #239 test vectors protect the existing workflow confidence model only. Confidence scoring is baseline/test/documentation work for the legacy workflow engine; it is **not** a governance maturity engine, **not** longitudinal evidence persistence, and **not** equivalent to `PersistenceAssessment`. The `recommendation-persistence` confidence factor remains a current provider-hint check and is **not** longitudinal `PersistenceAssessment` intelligence.

### Acceptance checklist

- [x] Existing governance/readiness controls inventoried.
- [x] Every identified invariant classified as PRESERVED, IMPROVED, REPLACED, or MISSING.
- [x] Persistence, telemetry, pricing, recommendation availability, tags, observation window, and approval dependencies identified.
- [x] Intentional divergences documented with strength, work, and IP authorization assessment.
- [x] Sprint 2 maturity implementation explicitly excluded from Sprint 1.
- [x] Regression inventory identifies controls to protect and validation commands.
