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

The AWS integration path has been validated for AssumeRole, credential refresh, failure recovery, and tenant isolation. See the report in [docs/validation/aws-integration-validation-readiness.md](docs/validation/aws-integration-validation-readiness.md).

## Disclaimer
Not affiliated with AWS, Amazon, or Mission Cloud.
