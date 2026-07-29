# Corrected Frontend Audit

## Date
2026-07-02

## Summary
This document corrects the Florence audit to match the current repository state. Several files referenced in the original audit do not exist in this repo, and some files have different line counts or statuses.

## Actual Page Inventory
| File | Exists | Lines | Notes |
|---|---|---|---|
| `frontend/index.html` | yes | 32 | Root frontend homepage shell |
| `frontend/pages/index.html` | yes | 39 | Marketing homepage |
| `frontend/pages/about.html` | yes | 97 | Static page |
| `frontend/pages/contact.html` | yes | 81 | Contact page with fake submit behavior |
| `frontend/pages/services.html` | yes | 767 | Static services page |
| `frontend/pages/assessment.html` | yes | 0 | Empty stub |
| `frontend/pages/dashboard.html` | yes | 0 | Empty stub |
| `frontend/pages/security.html` | yes | 0 | Empty stub |
| `frontend/pages/privacy.html` | yes | 71 | Static privacy page |
| `frontend/pages/terms.html` | no | - | Missing in repo |
| `frontend/pages/disclaimer.html` | no | - | Missing in repo |
| `frontend/pages/how-we-work.html` | no | - | Missing in repo |
| `frontend/pages/cookies.html` | no | - | Missing in repo |
| `frontend/portal/index.html` | no | - | Missing in repo; not the current dashboard |
| `Portal/dashboard/index.html` | yes | 164 | Existing portal dashboard placeholder |

## JS File Inventory
| File | Exists | Lines | Notes |
|---|---|---|---|
| `frontend/js/mock-data.js` | yes | 0 | Empty placeholder |
| `frontend/js/dashboard.js` | yes | 0 | Empty placeholder |
| `frontend/js/app.js` | yes | 0 | Empty placeholder |
| `frontend/js/ews-nav.js` | yes | 131 | Navigation only, no API behavior expected |

## Other repo findings
- `Portal/mock/data.ts` exists and is imported by `Portal/admin/clients/index.tsx`.
- `frontend/pages/services.tsx` exists with 461 lines alongside `frontend/pages/services.html`.
- `frontend/pages/security.tsx` exists with 73 lines alongside `frontend/pages/security.html`.
- The repo currently contains no root `index.html` file.
- The repo currently contains no `frontend/pages/terms.html`, `disclaimer.html`, `how-we-work.html`, or `cookies.html`.

## Audit correction notes
- The claim that `frontend/portal/index.html` is the real dashboard is incorrect for this repo state.
- The assessment, dashboard, and security pages are empty stubs and should be marked accordingly.
- There are two `.tsx` pages present in the `frontend/pages` folder, which indicates some React/TSX content exists without a full build setup.
- The actual page counts and line counts differ from the original audit and should be updated.

## Recommended corrected priorities
1. Treat `frontend/pages/contact.html` as the contact form page for Day 7 Formspree work.
2. Treat `frontend/pages/assessment.html` as the submitted onboarding form page, but note it is currently an empty stub.
3. Treat `Portal/dashboard/index.html` as the current portal dashboard placeholder, not `frontend/portal/index.html`.
4. Build out API integration in `frontend/js/dashboard.js` and `frontend/js/mock-data.js` once the actual page(s) needing live dashboard data are identified.
5. Remove nonexistent page entries from the audit before sharing with the team.
