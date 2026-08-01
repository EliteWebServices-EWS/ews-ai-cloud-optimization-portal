# AWS account onboarding validation report

## Files changed

See git status for the full list. Core additions:

- Model: `backend/repositories/models/aws-account-persistence-models.ts`
- Lifecycle: `backend/services/aws-account-lifecycle.ts`
- Contract: `backend/repositories/contracts/aws-account-repository.ts`
- Keys: `backend/database/aws-account/*`
- Repositories: mock + DynamoDB + factory
- SAM: `SisumAwsAccountsTable`, `AWS_ACCOUNTS_TABLE_NAME`, runtime IAM
- Deploy IAM: `sisum-aws-accounts-*`
- Scripts: `backend/scripts/create-aws-accounts-table.ts`
- Tests: `backend/tests/unit/aws-account-*.test.ts`, `mock-aws-account-repository.test.ts`, `dynamodb-aws-account-repository.test.ts`
- CI: `.github/workflows/aws-account-onboarding-validation.yml`

## Tests

Focused suite: `npm run test:aws-account-onboarding` — **65 tests**, all passing.

Full backend: `npm test` — **796 tests** (791 pass, 5 skipped), 0 failures.

Build: `npm run build` — success (tsc).

SAM: `sam validate --lint` — valid template; `sam build --no-cached` — **Build Succeeded**.

## Limitations

- Does not call STS or validate IAM trust policies
- Does not expose HTTP APIs
- Global lock retained after `DELETED` (prevents silent cross-tenant re-registration)
- `getByAccountId` is internal/platform scope

## Operational risks

- Misconfigured `AWS_ACCOUNTS_TABLE_NAME` in deployed env fails closed at startup (intentional)
- External IDs are sensitive — downstream logging must redact

## Recommended next work

- Engineer 2: AssumeRole validation service
- Engineer 3: tenant-scoped registration APIs
- Engineer 4: production readiness and evidence collection

## Validation commands

Run from `backend`:

- `npm run test:aws-account-onboarding`
- `npm test`
- `npm run build`
- `sam validate --lint --template-file template.yaml`
- `sam build --template-file template.yaml --no-cached`

Query-only: static test `aws-account-query-only.test.ts` plus grep for `ScanCommand` in new modules.

## Explicit boundaries

- No STS in this task
- No role trust verification
- Stores role ARN and external ID only — no credentials persisted
