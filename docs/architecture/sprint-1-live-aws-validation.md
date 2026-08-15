# Sprint 1 — Live AWS Validation Report

**Status:** **SPRINT 1 RELEASE GATE — PASS / LIVE AWS VALIDATED**
**Branch (documentation):** `docs/sprint-1-live-validation`
**Validation type:** Live AWS production async EC2 intelligence pipeline against a real running EC2 workload
**Canonical fixture QA record:** [sprint-1-evidence-fixtures-qa.md](./sprint-1-evidence-fixtures-qa.md)

---

## 1. Sprint 1 release gate

The Sprint 1 release gate is:

> A recommendation must answer: **What evidence supports this recommendation, and how long has that recommendation persisted?**

**Verdict:** **PASS / LIVE AWS VALIDATED**

Live AWS validation demonstrated that requirement end-to-end against a real EC2 workload in the connected test account.

---

## 2. Validation layers (read this first)

| Layer | Meaning in this document |
| --- | --- |
| **Local / test validation** | Sprint 1 fixture suite, DynamoDB adapter tests, orchestrator integration tests — implemented before deploy |
| **Live AWS validation** | Production async job, DynamoDB persistence, CloudWatch metrics, and dashboard-visible downstream stages in AWS account `572262081497` |
| **Diagnostics** | Safe structured logging that exposes AWS error metadata without changing business behavior (PD-3) |
| **Root-cause fixes** | Production code corrections validated by a subsequent live run (PD-1, PD-4) or hardening validated as part of the live path (PD-2) |
| **Non-blocking follow-ups** | Known UI/data-contract issues that do **not** invalidate the Sprint 1 evidence persistence release gate |

Persistence states (`NEW`, `STABLE`, `CHANGED`) are **not** connected to commercial confidence scoring in Sprint 1. Do not interpret recommendation `confidence: MEDIUM` as a persistence-state input.

---

## 3. Live test context

| Field | Value |
| --- | --- |
| AWS test account | `572262081497` |
| Region | `us-east-1` |
| Test EC2 instance | `i-0ce183611f7fc8ed2` |
| Instance type | `t3.micro` |
| Instance name | `Persistence-Intelligence-test` |
| Workload control | The test EC2 instance was intentionally left unchanged between validation runs so the production analyzer could independently determine whether the same recommendation persisted |

Public IP addresses are omitted from this record per repository security documentation practice.

---

## 4. Successful live async runs

### Run A — first live persistence baseline

| Field | Value |
| --- | --- |
| Job ID | `job-idem-4eeac445b3ccc742b4823c7e4e56a446` |
| Status | `SUCCEEDED` |
| Created | `2026-08-15T16:32:34Z` (approx.) |
| Started | `2026-08-15T16:32:36Z` (approx.) |
| Completed | `2026-08-15T16:32:38Z` (approx.) |

Stages completed: Queued → Starting → Discovering Resources → Running Cost Analysis → Running Security Analysis → Running Governance Analysis → Generating Recommendations → Completed.

### Run B — persistence revalidation

| Field | Value |
| --- | --- |
| Job ID | `job-idem-0693c0b806e7673074d3361f61793d7f` |
| Status | `SUCCEEDED` |
| Started | `2026-08-15T19:33:58Z` (approx.) |
| Completed | `2026-08-15T19:34:00Z` (approx.) |

All async stages completed successfully on both runs.

---

## 5. Live cost run validation

### Run B cost run — `job-idem-0693c0b806e7673074d3361f61793d7f#cost`

| Field | Value |
| --- | --- |
| status | `SUCCEEDED` |
| attemptCount | `1` |
| instancesFound | `1` |
| instancesEvaluated | `1` |
| insufficientDataCount | `1` |
| regions | `["us-east-1"]` |
| regionsSucceeded | `["us-east-1"]` |
| regionsFailed | `[]` |
| recommendationsCreated | `0` |
| recommendationsResolved | `0` |
| recommendationsUpdated | `1` |
| warnings | `[]` |

### Run A cost run — `job-idem-4eeac445b3ccc742b4823c7e4e56a446#cost`

| Field | Value |
| --- | --- |
| status | `SUCCEEDED` |
| attemptCount | `1` |
| instancesFound | `1` |
| instancesEvaluated | `1` |
| regionsSucceeded | `["us-east-1"]` |
| regionsFailed | `[]` |
| recommendationsCreated | `1` |
| recommendationsResolved | `1` |
| warnings | `[]` |

These persisted cost runs prove the production CloudWatch / cost-analysis path reached durable successful completion after PD-4 deploy.

---

## 6. Live recommendation

| Field | Value |
| --- | --- |
| category | `BURSTABLE_CREDIT_PRESSURE` |
| resource | `i-0ce183611f7fc8ed2` |
| resource type | `INSTANCE` |
| service | `ec2` |
| rule | `ec2.cost.burst_credit` |
| rule version | `1.0.0` |
| recommendation ID | `ec2cost-bca5daa0-de3a-4108-9425-295d703237b9` |
| recommended action | Review workload steady-state CPU; consider instance family change after approval. |
| business justification | Credit exhaustion can throttle performance; consider non-burstable types after review. |
| evidence summary | `creditMin=0, surplus=0` |
| confidence | `MEDIUM` |
| confidence score | `0.6` |
| current instance type | `t3.micro` |
| finding key | `tenant-msddsjji-n270imrc#572262081497#us-east-1#i-0ce183611f7fc8ed2#BURSTABLE_CREDIT_PRESSURE#1.0.0` |
| firstDetectedAt | `2026-08-15T16:32:38.015Z` |
| lastDetectedAt | `2026-08-15T19:34:00.240Z` |
| lifecycleStatus | `OPEN` |

---

## 7. Release-gate evidence — observations

### First live observation (Run A)

| Field | Value |
| --- | --- |
| analysisRunId | `job-idem-4eeac445b3ccc742b4823c7e4e56a446#cost` |
| observationTimestamp | `2026-08-15T16:32:37.607Z` |
| recommendationId | `ec2cost-bca5daa0-de3a-4108-9425-295d703237b9` |
| recommendationFingerprint | `7c366e0b2d3c6366dd4ce37d7a9338fea5d7d0f96139fd6e430427e365dfb03c` |
| state | `NEW` |
| persistenceHours | `null` |

Expected: no earlier matching observation existed.

### Second live observation (Run B) — decisive release-gate proof

| Field | Value |
| --- | --- |
| analysisRunId | `job-idem-0693c0b806e7673074d3361f61793d7f#cost` |
| observationId | `304162f8-a739-4da2-b40d-f41e5c0d3e0c` |
| observationTimestamp | `2026-08-15T19:33:59.757Z` |
| persistedAt | `2026-08-15T19:34:00.230Z` |
| recommendationId | `ec2cost-bca5daa0-de3a-4108-9425-295d703237b9` |
| recommendationFingerprint | `7c366e0b2d3c6366dd4ce37d7a9338fea5d7d0f96139fd6e430427e365dfb03c` |
| assessment.state | `STABLE` |
| assessment.persistenceHours | `2.6530827777777777` |
| assessment.comparedToObservationId | `f348a5c5-4e92-4de2-9938-299efd200bfa` |
| assessment.reasonCodes | `PERSISTENCE_FINGERPRINT_UNCHANGED` |
| assessment.logicalObservationId | `6abcbd07d052ef9aa6c4c6c9f49159eca1549ad3f24eb8512e0566a115df6e7e` |
| recommendedAction | Review workload steady-state CPU; consider instance family change after approval. |
| provenance | `ec2-cost-analysis` |

---

## 8. Release gate interpretation

### Question: What evidence supports this recommendation?

**Answer:** The live EC2 cost analyzer produced the `BURSTABLE_CREDIT_PRESSURE` finding from real CloudWatch evidence for the running `t3.micro` instance. The persisted observation contains the recommendation ID, recommendation fingerprint, finding key, provenance, rule ID/version, observed evidence summary, and recommended action.

### Question: How long has that recommendation persisted?

**Answer:** The later production observation is classified **`STABLE`** with:

| Field | Stored value |
| --- | --- |
| persistenceHours | `2.6530827777777777` |
| reasonCode | `PERSISTENCE_FINGERPRINT_UNCHANGED` |
| comparedToObservationId | `f348a5c5-4e92-4de2-9938-299efd200bfa` |

In prose: approximately **2.65 hours** between the compared observations. The stored numeric value above is authoritative; do not round it in evidence tables.

---

## 9. End-to-end live path satisfied

The live production path demonstrated:

```
real AWS EC2 workload
  → cross-account discovery
  → CloudWatch metrics
  → cost analysis
  → recommendation generation
  → evidence observation persistence
  → deterministic fingerprint comparison
  → STABLE persistence classification
  → positive persistenceHours
  → durable comparison to a previous observation
  → full async job completion
```

Therefore the Sprint 1 release gate is satisfied.

---

## 10. Production defect timeline (PD-1 through PD-4)

### PD-1 — LIVE AWS VALIDATED

| Field | Detail |
| --- | --- |
| Issue | Production EC2 composite finding keys contain `#`; prior sort-key validation rejected opaque `#` segments |
| Fix | `requireOpaqueKeyValue()` for EC2 finding keys in evidence observation keys |
| Live proof | DynamoDB evidence observation sort keys persisted finding keys such as `tenant-msddsjji-n270imrc#572262081497#us-east-1#i-0ce183611f7fc8ed2#BURSTABLE_CREDIT_PRESSURE#1.0.0` |
| Status | **LIVE AWS VALIDATED** |

### PD-2 — production hardening (not the sole pipeline fix)

| Field | Detail |
| --- | --- |
| Issue | Stage completion proof reads could observe stale `RUNNING` state after `completeRun()` due to eventually consistent DynamoDB `GetItem` |
| Fix | Strongly consistent `{ consistentRead: true }` on stage-proof `getRun()` paths |
| Status | **Production correctness hardening — validated as part of live async completion** |
| Note | PD-2 alone did not explain the later cost-stage `ValidationError`; that was an independent CloudWatch request-shape defect (PD-4) |

### PD-3 — diagnostics only (not the behavioral fix)

| Field | Detail |
| --- | --- |
| Purpose | Expose safe AWS SDK metadata when CloudWatch `GetMetricData` fails |
| Live diagnostic captured | `operation=GetMetricData`, `region=us-east-1`, `mappedCode=CLOUDWATCH_METRICS_FAILED`, `awsErrorName=ValidationError`, `awsHttpStatusCode=400` |
| Safety | No raw exception messages, stack traces, credentials, tokens, or request payloads logged |
| Status | **DIAGNOSTICS IMPLEMENTED / SUCCESSFULLY IDENTIFIED ROOT CAUSE** |
| Note | PD-3 is **not** the behavioral fix |

### PD-4 — ROOT CAUSE CONFIRMED / FIX DEPLOYED / LIVE AWS VALIDATED

| Field | Detail |
| --- | --- |
| Root cause | `GetMetricData` request contained both top-level `MetricDataQuery.Period` and `MetricStat.Period` |
| Live AWS reproduction | `ValidationError`: *The parameters MetricDataQueries.member.1.Period and MetricDataQueries.member.1.MetricStat are mutually exclusive and you have specified both.* |
| Control request | Direct AWS request using only `MetricStat.Period` succeeded and returned real `CPUUtilization` datapoints |
| Production fix | Remove top-level `MetricDataQuery.Period`; preserve `MetricStat.Period` and `ReturnData: true` |
| Post-fix live proof | Run B (`job-idem-0693c0b806e7673074d3361f61793d7f`) completed all async stages with `cost` run `SUCCEEDED`, `instancesEvaluated=1`, `warnings=[]` |
| Status | **ROOT CAUSE CONFIRMED / FIX DEPLOYED / LIVE AWS VALIDATED** |

---

## 11. Security and governance (supporting only)

These results support end-to-end async pipeline validation. They are **not** Sprint 1 persistence release-gate requirements.

| Area | Live result |
| --- | --- |
| Security findings | 8 observed |
| Governance score | 55/100 |

Observed examples included: missing required Owner tag; public IP present; SSH port 22 exposed to the internet; unencrypted EBS volume; no IAM instance profile; detailed monitoring disabled; naming standard issue; no enabled backup policy indicator.

This confirms Security and Governance stages executed after Cost. This section is **not** a security remediation plan.

---

## 12. Known non-blocking follow-ups

These items are tracked separately from the Sprint 1 release decision:

| ID | Observation | Disposition |
| --- | --- | --- |
| F-01 | Dashboard may display **Avg CPU: Not analyzed** despite successful cost analysis | Frontend / data-contract follow-up — **not fixed** |
| F-02 | Rightsizing rendering may display **NaN% utilization** | Frontend quality issue — must **not** be interpreted as zero utilization — **not fixed** |
| F-03 | Pricing displays **Pricing unavailable** | Pricing integration follow-up — cause not asserted here — **not fixed** |

These follow-ups do **not** invalidate the Sprint 1 evidence persistence release gate.

---

## 13. Sprint 1 release decision

**SPRINT 1 RELEASE GATE — PASS / LIVE AWS VALIDATED**

Reason: Live production validation demonstrated durable evidence observation persistence, deterministic fingerprint comparison, `STABLE` classification with positive `persistenceHours`, comparison to a prior observation, and full async job completion against a real EC2 workload.

Sprint 2 maturity work, commercial-confidence/persistence convergence, pricing display, and dashboard rendering fixes remain out of scope for this gate.

---

## 14. Related documentation

| Document | Purpose |
| --- | --- |
| [sprint-1-evidence-fixtures-qa.md](./sprint-1-evidence-fixtures-qa.md) | Canonical fixture catalogue and local/test QA |
| [sprint-1-persistence-intelligence.md](./sprint-1-persistence-intelligence.md) | Persistence semantics and orchestrator wiring |
| [sprint-1-confidence-baseline.md](./sprint-1-confidence-baseline.md) | Commercial confidence baseline (not connected to persistence states) |
| [sprint-13-production-validation-report.md](../validation/sprint-13-production-validation-report.md) | Prior live AWS account integration foundation |
