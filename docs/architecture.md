# Architecture Overview – EWS Platform

## High-Level Components
- Marketing Website (Static)
- EWS-Lite Portal (UI-only)
- GitHub Pages (Hosting)
- GitHub Actions (CI/CD – later phase)

## Website Stack
- HTML / CSS / JavaScript
- Tailwind CSS
- Static assets
- GitHub Pages

## Portal Stack (Phase 1)
- UI-only React components
- Mock data (JSON)
- No backend services

## Security Model (Phase 1)
- No authentication
- No customer data
- Read-only demo views

## Future Phases
- AWS integration
- Cognito auth
- Lambda APIs
