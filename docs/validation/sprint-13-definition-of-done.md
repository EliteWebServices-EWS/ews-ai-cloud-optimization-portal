# Sprint 13 — Definition of Done matrix

**Sprint:** Live AWS Account Integration & Evidence Collection Foundation
**Status values:** COMPLETE | COMPLETE WITH LIMITATION | NOT COMPLETE | OUT OF SCOPE

Production evidence: [sprint-13-production-validation-report.md](./sprint-13-production-validation-report.md)

---

| Requirement | Status | Implementation evidence | Test evidence | Production evidence | Residual note |
|-------------|--------|-------------------------|---------------|---------------------|---------------|
| Durable AWS account persistence | COMPLETE | #185 `dynamodb-aws-account-repository.ts` | Repository + API unit tests | Account v1→4 through verify/discovery | — |
| Generated External ID | COMPLETE | Registration service | API tests | External ID generated (redacted in docs) | Handle as secret |
| Secure AssumeRole | COMPLETE | #183 STS adapter, SAM policy | `test:sts-assumerole`, unit suite | AssumeRole + assumed-role ARN | — |
| Temporary credentials only | COMPLETE | Credential manager | STS tests | No persisted keys | Ephemeral Lambda cache |
| Permission validation | COMPLETE | Verify flow + probes | Route/service tests | All six required probes SUCCEEDED | — |
| Account-management APIs | COMPLETE | #184 routes | HTTP tests | Register/list/get/verify | — |
| Tenant isolation | COMPLETE | Tenant-scoped keys + context | Isolation tests | Tenant `tenant-msddsjji-n270imrc` | — |
| RBAC | COMPLETE | Membership middleware | RBAC tests | Owner operated account APIs | Bootstrap required first |
| Audit events | COMPLETE | Account flows | Unit tests | Ops observation | Redaction enforced |
| Pagination | COMPLETE | List accounts API | Tests | — | — |
| Optimistic locking | COMPLETE | `version` / `expectedVersion` | Concurrency tests | Verify required version | Operators must GET first |
| Live account verification | COMPLETE | Verify endpoint | Tests + workflow | HTTP 200 VERIFIED v3 | — |
| Live account discovery | COMPLETE | #187 POST discovery | Discovery tests | HTTP 200 v4 | POST not GET |
| Discovery persistence | COMPLETE | Metadata on account record | Tests | metadata persisted | Sanitized only |
| Operational runbook | COMPLETE | [runbook](../operations/sprint-13-live-aws-integration-runbook.md) | — | Used during validation | — |
| Security report | COMPLETE | [security doc](../security/sprint-13-security-validation.md) | MFA/bootstrap tests | Reviewed controls | Least privilege gap documented |
| Production validation | COMPLETE | [validation report](./sprint-13-production-validation-report.md) | — | Live AWS accounts | — |
| Rollback procedure | COMPLETE | Closeout + release notes | — | — | Customer trust revoke primary |
| Documentation completeness | COMPLETE | Sprint 13 doc set + index updates | — | — | — |
| Least privilege proof | COMPLETE WITH LIMITATION | Field NOT_VERIFIED by design | Tests assert NOT_VERIFIED | Confirmed in discovery | Needs IAM analyzer |
| Narrow customer IAM policy rollout | OUT OF SCOPE | Security recommendations only | — | ReadOnlyAccess used in validation | Sprint 14 proposal |
| IAM policy inspection | NOT COMPLETE | Not implemented | — | — | Future work |

---

## Summary

| Category | Count |
|----------|-------|
| COMPLETE | 19 |
| COMPLETE WITH LIMITATION | 1 |
| NOT COMPLETE | 1 (IAM policy inspection — planned future) |
| OUT OF SCOPE | 1 (narrow policy rollout) |

**Sprint 13 DoD:** **Met** for live integration scope with documented limitations on least-privilege verification and customer policy breadth.

---

## Related documentation

- [Lessons learned](./sprint-13-lessons-learned.md)
- [Closeout](../handoff/sprint-13-closeout.md)
