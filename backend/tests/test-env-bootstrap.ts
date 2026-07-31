/**
 * Preloads before any test module via `tsx --import`.
 *
 * Parent shells (and GitHub `environment: production` jobs) may export
 * ENVIRONMENT=production. persistence-config resolves ENVIRONMENT before
 * NODE_ENV, which would otherwise enable deployed persistence validation
 * during module import (for example lambda.ts → createApp).
 */

process.env.NODE_ENV = 'test';
process.env.ENVIRONMENT = 'test';
process.env.PERSISTENCE_ENABLED = 'false';
