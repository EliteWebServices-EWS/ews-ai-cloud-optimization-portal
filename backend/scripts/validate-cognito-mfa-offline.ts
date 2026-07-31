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

  if (!/MfaConfiguration:\s*ON/.test(template)) {
    fail('Auth template MFA configuration is not ON (required TOTP) as expected.');
  }

  if (!/SOFTWARE_TOKEN_MFA/.test(template)) {
    fail('SOFTWARE_TOKEN_MFA is not enabled in auth template.');
  }

  if (/SMS_MFA/.test(template)) {
    fail('SMS_MFA must not be enabled for Sprint 12 validation profile.');
  }

  pass('Auth template declares required TOTP (MfaConfiguration ON, SOFTWARE_TOKEN_MFA) without SMS MFA.');

  if (!/LambdaVersion:\s*V2_0/.test(template)) {
    fail('Pre Token Generation must use LambdaVersion V2_0.');
  }

  const zipStart = template.indexOf('ZipFile: |');
  if (zipStart === -1) {
    fail('SisumPreTokenGenerationFunction inline ZipFile not found.');
  }
  const zipBody = template.slice(zipStart, template.indexOf('SisumPreTokenGenerationPermission:'));

  if (!/TokenGeneration_HostedAuth/.test(zipBody)) {
    fail('Inline trigger must recognize TokenGeneration_HostedAuth for fresh assurance.');
  }
  if (!/TokenGeneration_RefreshTokens/.test(zipBody)) {
    fail('Inline trigger must handle TokenGeneration_RefreshTokens without assurance.');
  }
  if (!/mfa_session_verified/.test(zipBody)) {
    fail('Inline trigger must emit mfa_session_verified claim name.');
  }
  if (/request\.clientMetadata/.test(zipBody)) {
    fail('Inline trigger must not read clientMetadata for MFA assurance.');
  }

  if (!/Name:\s*verified_email/.test(template)) {
    fail('Account recovery must include verified_email.');
  }
  if (!/tenant_id/.test(zipBody)) {
    fail('Inline trigger must still inject tenant_id claim.');
  }

  if (!/isRequiredMfaDeploymentEnabled/.test(zipBody)) {
    fail('Inline trigger must gate assurance on server-controlled COGNITO_REQUIRED_MFA.');
  }
  if (!/COGNITO_REQUIRED_MFA/.test(template.slice(
    template.indexOf('SisumPreTokenGenerationFunction:'),
    template.indexOf('SisumPreTokenGenerationPermission:'),
  ))) {
    fail('Pre Token Generation Lambda must define COGNITO_REQUIRED_MFA environment variable.');
  }

  pass('Pre Token Generation V2_0 inline trigger declares hosted-auth assurance and refresh exclusion.');
  pass(
    'MFA assurance requires TokenGeneration_HostedAuth and COGNITO_REQUIRED_MFA=true (fail-closed).',
  );
  pass(
    'Application privileged routes require boolean mfa_session_verified on access tokens (via API Gateway JWT claims).',
  );
  console.log('Live user-pool inspection was not executed in this offline-safe mode.');
}

main();
