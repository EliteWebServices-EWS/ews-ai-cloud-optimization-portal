# Reporting Engine

**Project:** SISU'M Cloud Optimization Decision Platform

**Version:** 1.0

**Status:** Sprint 9

**Depends On:**

- `01-architecture-specification.md`
- `02-api-specification.md`
- `05-engine-implementation-guide.md`

---

## 1. Purpose

The Reporting Engine is a **presentation and aggregation layer**. It converts completed optimization workflow results into structured, human-readable reports for API consumers and the frontend.

The Reporting Engine does **not**:

- Calculate savings
- Modify recommendations
- Re-evaluate governance
- Call AWS or providers
- Contain optimization logic

---

## 2. Architecture Position

```text
Workflow Result
      ↓
Reporting Engine
      ↓
Report Model
      ↓
API Layer
      ↓
Frontend
```

The Reporting Engine sits alongside other core engines. It reads aggregated workflow outputs produced by the Orchestrator and upstream engines.

---

## 3. Responsibilities

- Aggregate workflow results into structured reports
- Format optimization findings for business and technical audiences
- Prepare executive summaries using deterministic templates
- Prepare technical summaries from existing engine outputs
- Persist reports in Demo Mode (in-memory store)
- Support list filtering by status, resource type, confidence, and verification
- Prepare export-ready models (JSON available; PDF/CSV future)

---

## 4. Report Lifecycle

```text
1. Workflow completes (Orchestrator)
2. API receives POST /reports/generate { workflowId }
3. Orchestrator workflow record retrieved
4. Reporting Engine aggregates data → OptimizationReport
5. Report persisted in Report Store
6. API returns report JSON
7. Frontend renders report components
```

Reports are idempotent per workflow: generating a report for the same `workflowId` returns the cached report.

---

## 5. Report Models

| Model | Description |
|---|---|
| `OptimizationReport` | Complete structured report |
| `ReportSummary` | Executive headline, savings totals, template summaries |
| `ResourceSummary` | Per-resource analysis details |
| `SavingsSummary` | Aggregated financial figures (from Financial Engine) |
| `DecisionSummary` | Recommendation and governance rationale |
| `VerificationSummary` | Verification outcome (from Verification Engine) |

Models are defined in `backend/shared/types/report.types.ts`.

---

## 6. API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/reports` | List reports with optional filters |
| `GET` | `/api/v1/reports/:id` | Retrieve full report by ID |
| `POST` | `/api/v1/reports/generate` | Generate report from workflow ID |

### Filter Query Parameters

- `status` — `complete`, `partial`, `failed`, `empty`
- `resourceType` — e.g. `EC2`
- `confidenceLevel` — `HIGH`, `MEDIUM`, `LOW`
- `verificationStatus` — `verified`, `partial`, `failed`, `pending`
- `plugin` — e.g. `ec2`

---

## 7. Logging

The Reporting Engine logs:

- Report generation started (`workflowId`, timestamp)
- Report generated (`reportId`, `workflowId`, `status`, duration)
- Report failed (`workflowId`, error reason)

---

## 8. Error Handling

| Code | Meaning |
|---|---|
| `MISSING_WORKFLOW` | Workflow ID not provided |
| `NOT_FOUND` | Workflow or report not found |
| `REPORT_GENERATION_FAILED` | Unexpected aggregation failure |
| `INCOMPLETE_OPTIMIZATION` | Partial data — report status set to `partial` |

---

## 9. Export Support (Future)

Export-ready structures are prepared for:

- **JSON** — available in MVP
- **CSV** — future sprint
- **PDF** — future sprint

File generation is intentionally not implemented in Sprint 9.

---

## 10. Folder Structure

```text
backend/engines/reporting/
├── report.engine.ts      # Engine entry point
├── report.generator.ts   # generateReport, summaries
├── report.store.ts       # In-memory persistence
├── report.filter.ts      # List filtering
├── report.export.ts      # Export-ready models
├── report.errors.ts      # Structured errors
└── index.ts
```

---

## 11. Testing

Unit tests in `backend/tests/unit/reporting.engine.test.ts` cover:

- Successful report generation
- Empty workflow
- Incomplete data
- Failed verification
- Confidence filtering
- Template-based summaries

---

## 12. Definition of Complete

Sprint 9 Reporting Layer is complete when:

- Reporting Engine aggregates workflow results without recalculating business logic
- Report models are typed and exported
- API endpoints return JSON reports
- Frontend Reports page displays summaries
- Filtering works for confidence and verification
- Export structure is prepared for future formats
- Tests pass and backend compiles
