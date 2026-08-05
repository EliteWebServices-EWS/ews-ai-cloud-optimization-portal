# AWS account discovery validation

## Scope

Sprint 13 enhancement: discovery service, permission summary extension, `POST .../discovery`, audit events, tests, SAM `sts:AssumeRole` policy.

Production closeout: [sprint-13-production-validation-report.md](./sprint-13-production-validation-report.md).

## Tests

- `tests/unit/aws-account-discovery.test.ts`
- `tests/unit/aws-account-api-service-discovery.test.ts`
- `tests/unit/permission-validator.test.ts` (summary extension)
- `tests/integration/aws-account-api-http.test.ts` (discovery HTTP)

Run:

```bash
cd backend
npm ci
npm test
npm run build
sam validate --lint
sam build --no-cached
```

## Limitations

- No IAM policy document inspection in this sprint → `leastPrivilegeAssurance` stays `NOT_VERIFIED`.
- Real AWS calls are not used in default CI (injected clients / discovery runner).

## Manual production validation

1. Deploy backend with `SisumStsAssumeRolePolicy`.
2. Register a test account with correct ExternalId trust.
3. Call discovery endpoint; verify DynamoDB `metadata.discovery` and CloudWatch audit events (`aws_account.discovery_*`).
