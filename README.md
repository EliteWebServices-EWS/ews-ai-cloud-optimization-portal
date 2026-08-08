# EWS AI Cloud Optimization Portal

## Overview
AI-assisted AWS cost optimization inspired by enterprise FinOps platforms.

## Architecture
- GitHub Pages (Frontend)
- AWS Lambda + API Gateway (Backend)
- STS AssumeRole (Customer Access)
- Claude AI (Insights only)

## Security Model
- Cross-account IAM role
- External ID
- Read-only access
- No access keys

## Validation & operational readiness

The AWS integration path has been validated for AssumeRole, credential refresh, failure recovery, and tenant isolation. See [docs/validation/aws-integration-validation-readiness.md](docs/validation/aws-integration-validation-readiness.md).

**Sprint 13 (live AWS production, COMPLETE):** [production validation report](docs/validation/sprint-13-production-validation-report.md), [closeout](docs/handoff/sprint-13-closeout.md), [architecture](docs/architecture/sprint-13-live-aws-integration.md), [runbook](docs/operations/sprint-13-live-aws-integration-runbook.md), [security](docs/security/sprint-13-security-validation.md), [release notes](docs/releases/sprint-13-release-notes.md).

**Sprint 14 — EC2 discovery (Engineer 1, production validated):** [EC2 discovery validation](docs/validation/ec2-discovery-validation.md#production-validation-sprint-14-engineer-1), [runbook](docs/operations/ec2-discovery-runbook.md), [architecture](docs/architecture/ec2-discovery-plugin.md).

## Disclaimer
Not affiliated with AWS, Amazon, or Mission Cloud.
