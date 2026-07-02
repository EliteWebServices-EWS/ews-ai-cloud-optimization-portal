# Florence — Day 1 Frontend Audit
## Week 1, Sprint Plan (2-Week Backend-to-Live)
**Date:** July 2026  
**Purpose:** Identify every page, every component that will need live backend data, and document the contact page location for Day 7 Formspree work.

---

## 1. Full Page Inventory

| File | Lines | Status | Notes |
|---|---|---|---|
| `index.html` (root) | 11 | Redirect only | Just redirects to `frontend/index.html` |
| `frontend/index.html` | 24 | Static shell | Loads `ews-nav.js` + `master-theme.js`, no data |
| `frontend/portal/index.html` | 255 | **Main portal dashboard** | All mock data, no API calls yet |
| `frontend/pages/index.html` | 43 | Marketing homepage | Static, no data needed |
| `frontend/pages/about.html` | 75 | Static | No backend data needed |
| `frontend/pages/contact.html` | 79 | **Needs Formspree** | Form is a fake UI mock — no real submission |
| `frontend/pages/services.html` | 790 | Static | No backend data needed |
| `frontend/pages/assessment.html` | 66 | **Needs API** | Form fields map to onboarding — will POST data |
| `frontend/pages/dashboard.html` | 15 | Empty stub | Not the real dashboard — `frontend/portal/index.html` is |
| `frontend/pages/security.html` | 71 | Static | No backend data needed |
| `frontend/pages/privacy.html` | 68 | Static | No backend data needed |
| `frontend/pages/terms.html` | 66 | Static | No backend data needed |
| `frontend/pages/disclaimer.html` | 58 | Static | No backend data needed |
| `frontend/pages/how-we-work.html` | 64 | Static | No backend data needed |
| `frontend/pages/cookies.html` | 53 | Static | No backend data needed |
| `Portal/dashboard/index.html` | 11 | Empty stub | Old placeholder, not the real dashboard |

---

## 2. Contact Page Location (for Day 7)

```
frontend/pages/contact.html
```

Current state: has a basic contact form with name, email, company, message fields.  
The form currently fakes a success message on submit but **does not send anything** — there is no backend or Formspree hooked up yet.  
Day 7 task: replace the existing form with the full Formspree markup (name, email, company, phone, aws_account, monthly_spend dropdown, message, honeypot fields).

---

## 3. API Integration Points — Every Component That Needs Live Data

### 3A. `frontend/portal/index.html` — The Main Portal Dashboard
**This is the most important file for backend integration. All data below is currently hardcoded/mock.**

| Component | Current State | API Endpoint (from sprint plan) | Data Needed |
|---|---|---|---|
| Client dropdown / selector | Hardcoded list | `GET /v1/clients` | List of all clients with id, name, status |
| Monthly Spend card | Hardcoded "$1,240.50" | `GET /v1/dashboard/:id` | `spend.current` |
| Forecasted Spend card | Hardcoded "$1,310.00" | `GET /v1/dashboard/:id` | `spend.forecast` |
| Savings Opportunity card | Hardcoded "$210" | `GET /v1/dashboard/:id` | `spend.savingsOpportunity` |
| Active EC2 Instances card | Hardcoded "14" | `GET /v1/dashboard/:id` | `resources.ec2Count` |
| S3 Storage card | Hardcoded "3.2 TB" | `GET /v1/dashboard/:id` | `resources.s3Storage` |
| Uptime card | Hardcoded "99.95%" | `GET /v1/dashboard/:id` | `resources.uptime` |
| Security alerts list | Hardcoded 3 items | `GET /v1/dashboard/:id` | `security.alerts[]` |
| Open Alerts count | Hardcoded "3" | `GET /v1/dashboard/:id` | `security.alertCount` |
| Sync button | Does nothing currently | `POST /v1/clients/:id/sync` | Triggers live AWS sync |
| `dataSource` label | Not shown currently | All endpoints return `dataSource` field | Show 'mock', 'cached', or 'aws' |
| Last synced timestamp | Not shown currently | `GET /v1/dashboard/:id` | `lastSync` field |

### 3B. `frontend/pages/assessment.html` — AWS Readiness Assessment Form
| Component | Current State | API Endpoint | Data Needed |
|---|---|---|---|
| Assessment form submission | Static form, no submit action | `POST /v1/clients` (new client onboarding) | Form data sent to create a new tenant record |

### 3C. `frontend/pages/contact.html` — Contact Page
| Component | Current State | API Endpoint | Data Needed |
|---|---|---|---|
| Contact form | Fake submit (JS success message only) | Formspree (Day 7) | Not a backend API — uses Formspree third-party service |

---

## 4. JavaScript Files That Will Need the API Base URL

| File | Current State | What Needs to Change |
|---|---|---|
| `frontend/js/mock-data.js` | Empty (1 line) | Will hold the `ews_api_base` config + mock fallback data |
| `frontend/js/dashboard.js` | Empty (1 line) | Will hold all `fetch()` calls to the live API |
| `frontend/js/app.js` | Empty (1 line) | May hold shared utilities / auth token handling |
| `frontend/js/ews-nav.js` | 131 lines, navigation only | No API calls needed here |
| `frontend/portal/index.html` (inline script) | All mock hardcoded data | Will need to call `GET /v1/clients` and `GET /v1/dashboard/:id` |

**Day 4 note (prep for Day 5):** When Mpho shares the `ApiUrl` from the AWS deploy, these are the exact places it needs to go:
1. `localStorage.setItem('ews_api_base', 'YOUR_API_URL')` — set once in browser console to make it permanent
2. `frontend/js/dashboard.js` — all `fetch()` calls should read from `localStorage.getItem('ews_api_base')`
3. `frontend/js/mock-data.js` — will hold fallback mock data for when no API URL is set

---

## 5. States Needed for Every Data-Driven Component (Day 2 prep)

Every component in `frontend/portal/index.html` that shows live data needs three states built:

| State | What to Show |
|---|---|
| **Loading** | Spinner or "Loading..." text while the API fetch is in progress |
| **Empty** | "No data available" or "No alerts detected" — when the API returns an empty array |
| **Error** | "Could not load data — please try again" — when the fetch fails or returns non-200 |

Currently none of these states exist — the page just shows hardcoded values always.

---

## 6. Issues Found During Audit (for Day 2 corrections)

1. **Two duplicate dashboard files**: `frontend/pages/dashboard.html` (15 lines, empty stub) and `frontend/portal/index.html` (255 lines, real dashboard). The stub `dashboard.html` is misleading — should either be deleted or redirect to the real one.
2. **`frontend/js/dashboard.js` and `frontend/js/mock-data.js` are both empty** — they exist as 1-line placeholder files. All dashboard logic is currently inline inside `frontend/portal/index.html`.
3. **`Portal/dashboard/index.html` is now also an empty stub** (11 lines) — it was replaced by `frontend/portal/index.html` as the real dashboard but wasn't cleaned up.
4. **`frontend/portal/index.html` has an encoding issue** — there is a stray non-UTF-8 character in the page title ("EWS AI Cloud Optimization Portal M-^] Demo"). Needs to be cleaned up.
5. **Contact form** currently shows "Phase 1 UI mockup — form submissions aren't wired to a backend yet. Please email us directly for now." — this note should be removed on Day 7 when Formspree is wired up.
6. **`frontend/pages/services.tsx`** — a 38-line `.tsx` file alongside `services.html`. Still no React build setup in the repo. Dead code.

---

## 7. Summary

- **Pages needing backend data:** 2 (`frontend/portal/index.html`, `frontend/pages/assessment.html`)
- **Pages needing Formspree (Day 7):** 1 (`frontend/pages/contact.html`)
- **Pages that are fully static (no backend needed):** 13
- **JS files to build out:** 2 (`dashboard.js`, `mock-data.js`)
- **Corrections to make in Day 2:** 6 issues listed above
