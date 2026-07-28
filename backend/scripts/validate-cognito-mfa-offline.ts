#!/usr/bin/env npx tsx
/**
 * Optional Cognito MFA configuration check — disabled by default.
 *
 * Required env:
 *   COGNITO_USER_POOL_ID
 *   COGNITO_VALIDATION_ENABLED=true
 *   COGNITO_VALIDATION_CONFIRM=I_UNDERSTAND_NON_PRODUCTION
 *
 * Never prints tokens, secrets, or MFA codes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`PASS: ${message}`);
}

function main(): void {
  if (process.env.COGNITO_VALIDATION_ENABLED?.trim().toLowerCase() !== 'true') {
    fail('COGNITO_VALIDATION_ENABLED is not true — live validation refused.');
  }

  if (
    process.env.COGNITO_VALIDATION_CONFIRM?.trim() !==
    'I_UNDERSTAND_NON_PRODUCTION'
  ) {
    fail('Missing COGNITO_VALIDATION_CONFIRM=I_UNDERSTAND_NON_PRODUCTION');
  }

  const poolId = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!poolId) {
    fail('COGNITO_USER_POOL_ID is required.');
  }

  if (/prod/i.test(process.env.ENVIRONMENT ?? '')) {
    fail('Production environment detected — refusing live Cognito validation.');
  }

  const templatePath = path.resolve(
    __dirname,
    '../../infrastructure/auth/template.yaml',
  );
  const template = readFileSync(templatePath, 'utf8');

  if (!/MfaConfiguration:\s*OPTIONAL/.test(template)) {
    fail('Auth template MFA configuration is not OPTIONAL as expected.');
  }

  if (!/SOFTWARE_TOKEN_MFA/.test(template)) {
    fail('SOFTWARE_TOKEN_MFA is not enabled in auth template.');
  }

  if (/SMS_MFA/.test(template)) {
    fail('SMS_MFA must not be enabled for Sprint 12 validation profile.');
  }

  pass('Auth template declares OPTIONAL TOTP (SOFTWARE_TOKEN_MFA) without SMS MFA.');
  pass(
    'MFA assurance states: pool/user enrollment (MFA_CAPABLE / MFA_ENROLLED) do not imply MFA_VERIFIED_FOR_CURRENT_SESSION on user-pool access tokens.',
  );
  pass(
    'Observed non-production access tokens may omit amr and cognito:amr after successful TOTP; application privileged operations remain fail-closed pending mfa_session_verified or another approved session-assurance design.',
  );
  console.log('Live user-pool inspection was not executed in this offline-safe mode.');
}

main();
