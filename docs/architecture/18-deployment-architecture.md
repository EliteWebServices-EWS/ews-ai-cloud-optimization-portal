# 18 – Deployment Architecture

**Version:** 1.0

**Status:** Approved

**Owner:** EWS Engineering

---

# Purpose

This document defines the deployment architecture for the SISU'M Cloud Optimization Decision Platform.

It describes how the frontend, backend, APIs, infrastructure, and deployment pipelines work together.

This document serves as the deployment standard for all engineering teams.

---

# Goals

The deployment architecture must:

- Support Demo Mode (MVP)
- Be production-ready
- Be highly scalable
- Be cost optimized
- Be secure
- Be cloud-native
- Support future SaaS growth
- Require minimal infrastructure management

---

# Deployment Philosophy

The application is divided into independent deployment units.

```
Marketing Website

↓

Customer Dashboard

↓

Backend APIs

↓

Workflow Engine

↓

Cloud Providers
```

Each component can be deployed independently.

This minimizes downtime and simplifies future upgrades.

---

# High-Level Deployment Architecture

```
                    Internet
                        │
                        ▼
                 Amazon Route 53
                        │
                        ▼
                  Amazon CloudFront
                        │
      ┌─────────────────┴──────────────────┐
      │                                    │
      ▼                                    ▼
Marketing Website                  SISU'M Dashboard
 (Amazon S3)                       (Amazon S3)
                                           │
                                           ▼
                                  Amazon Cognito
                                           │
                                    JWT Authentication
                                           │
                                           ▼
                                     API Gateway
                                           │
                                           ▼
                                     AWS Lambda
                                           │
                                           ▼
                               Workflow Orchestrator
                                           │
          ┌─────────────────────────────────────────────────┐
          ▼             ▼             ▼             ▼
     Evidence      Governance    Financial    Verification
      Engine          Engine        Engine         Engine
          └─────────────────────────────────────────────────┘
                                           │
                                           ▼
                                    Plugin Layer
                                           │
                                           ▼
                                 Provider Interface
                                           │
                         ┌──────────────────────────────┐
                         ▼                              ▼
                  Mock Provider                  AWS Provider
```

---

# Deployment Components

## 1. Marketing Website

Purpose:

- Company website
- Services
- About
- Contact
- Pricing
- Blog

Hosting:

- Amazon S3
- Amazon CloudFront

Domain:

```
elitewebservices.org
```

Characteristics:

- Static website
- No backend
- No authentication
- Fast global delivery

---

## 2. SISU'M Dashboard

Purpose:

Customer application.

Features:

- Dashboard
- Reports
- Optimization
- Recommendations
- Settings

Hosting:

- Amazon S3
- CloudFront

Domain:

```
portal.elitewebservices.org
```

Framework:

React + Vite

Deployment:

Static assets only.

---

## 3. Authentication

Service:

Amazon Cognito

Responsibilities:

- User registration
- Login
- Password reset
- MFA (future)
- Token generation

Output:

JWT Access Token

The frontend never stores AWS credentials.

---

## 4. API Layer

Service:

Amazon API Gateway

Responsibilities:

- Route requests
- Validate JWT tokens
- Rate limiting
- API versioning
- Request validation

Example:

```
POST /api/v1/workflows/run
```

---

## 5. Backend

Service:

AWS Lambda

Responsibilities:

- Execute workflow
- Call engines
- Return reports

Lambda does NOT contain UI logic.

---

## 6. Workflow Orchestrator

Responsibilities:

Coordinate the optimization workflow.

Sequence:

```
Evidence

↓

Governance

↓

Financial

↓

Recommendation

↓

Verification

↓

Reporting
```

---

## 7. Engines

The engines are deployed as part of the backend.

They are not independent services.

Advantages:

- Lower cost
- Simpler deployment
- Easier testing

Future versions may separate them if necessary.

---

## 8. Plugins

Plugins remain part of the backend deployment.

Examples:

```
EC2

EBS

RDS

S3

Lambda
```

Plugins never call AWS directly.

---

## 9. Provider Layer

Supported providers:

```
Mock Provider

AWS Provider
```

Demo Mode:

Uses Mock Provider.

Production:

Uses AWS Provider.

The rest of the application is unchanged.

---

# Environment Strategy

The platform supports multiple environments.

## Development

Purpose:

Local development.

Provider:

Mock

Example:

```
PROVIDER_MODE=mock
```

---

## Testing

Purpose:

CI validation.

Provider:

Mock

Automated testing.

---

## Staging

Purpose:

Pre-production testing.

Provider:

AWS

Limited AWS account.

---

## Production

Purpose:

Customer environment.

Provider:

AWS

High availability.

---

# CI/CD Pipeline

Source Control

```
GitHub
```

Pipeline

```
GitHub Actions
```

Deployment Flow

```
Developer

↓

Git Push

↓

Pull Request

↓

Review

↓

Merge

↓

GitHub Actions

↓

Build

↓

Test

↓

Deploy
```

---

# Frontend Deployment

Pipeline:

```
GitHub

↓

GitHub Actions

↓

npm install

↓

npm run build

↓

Upload dist/

↓

Amazon S3

↓

CloudFront Invalidation
```

Only production assets are deployed.

Source code is never deployed.

---

# Backend Deployment

Pipeline:

```
GitHub

↓

GitHub Actions

↓

Install Dependencies

↓

Run Tests

↓

Build

↓

SAM Build

↓

SAM Deploy

↓

AWS Lambda
```

Infrastructure is deployed using AWS SAM.

---

# Configuration Management

Environment variables must never be hardcoded.

Examples:

```
PROVIDER_MODE

AWS_REGION

AWS_ACCOUNT_ID

AWS_ROLE_ARN

API_VERSION

LOG_LEVEL
```

Configuration is loaded during application startup.

---

# Secrets Management

Secrets must never be stored in Git.

Use:

- AWS Secrets Manager
- GitHub Actions Secrets

Never commit:

- Access keys
- Secret keys
- Tokens
- Passwords

---

# Monitoring

Services:

- Amazon CloudWatch Logs
- CloudWatch Metrics

Track:

- API errors
- Lambda failures
- Execution duration
- Workflow status
- Recommendation counts

---

# Logging

All backend components use structured logging.

Log:

- Workflow started
- Workflow completed
- Provider selected
- Engine execution
- Errors
- Warnings

Never log sensitive information.

---

# Security

All communication uses HTTPS.

Authentication:

Amazon Cognito

Authorization:

JWT

Future:

- RBAC
- Multi-tenancy
- Audit logs

---

# Scaling Strategy

Current MVP

```
Single Lambda
```

Growth

```
Multiple Lambda Functions
```

Enterprise

```
API Gateway

↓

Multiple Lambda Functions

↓

EventBridge

↓

SQS

↓

Step Functions
```

The architecture supports future horizontal scaling without changing business logic.

---

# Rollback Strategy

Every deployment must support rollback.

If deployment fails:

1. Stop deployment.
2. Restore previous version.
3. Notify engineering.
4. Preserve logs.

---

# Disaster Recovery

Source code:

GitHub

Infrastructure:

AWS SAM Templates

Configuration:

Environment Variables

Secrets:

AWS Secrets Manager

Static Assets:

Amazon S3 Versioning

---

# Estimated AWS Services

Frontend

- Amazon S3
- CloudFront

Authentication

- Amazon Cognito

Backend

- API Gateway
- AWS Lambda

Monitoring

- CloudWatch

Future

- DynamoDB
- EventBridge
- SQS
- Step Functions

---

# Cost Optimization

The platform follows a serverless-first strategy.

Benefits:

- Pay only for usage
- No idle servers
- Automatic scaling
- Minimal operational overhead

Estimated MVP cost:

Approximately **$5–20 USD/month**, depending on traffic and usage.

---

# Deployment Roadmap

## Sprint 1–10

- MVP development
- Mock Provider
- GitHub Pages (temporary)

## Sprint 10.5

Infrastructure migration:

- Route 53
- CloudFront
- Amazon S3
- API Gateway
- AWS Lambda

## Sprint 11–17

- AWS Provider
- Live AWS integration
- CloudWatch
- Pricing API
- DynamoDB

## Phase 4

- Authentication
- RBAC
- Multi-tenancy
- Audit logging

---

# Definition of Success

A deployment is considered successful when:

- Frontend is accessible
- APIs respond successfully
- Workflow completes
- Reports are generated
- Monitoring is active
- Logs are available
- HTTPS is enabled
- Rollback is possible

The deployment architecture must remain cloud-native, modular, secure, scalable, and cost-optimized while supporting future enterprise growth.