#!/usr/bin/env npx tsx
/**
 * Sprint 13 production readiness evidence checker — non-destructive.
 *
 * Validates JSON evidence files (real API envelopes or direct inner objects).
 * Never prints tokens, External IDs, Authorization headers, or secret keys.
 *
 * Environment / file inputs:
 *   SPRINT13_ACCOUNT_REGISTRATION_RESPONSE — path to JSON file
 *   SPRINT13_VERIFICATION_RESPONSE — path to JSON file
 *   SPRINT13_DISCOVERY_RESPONSE — path to JSON file
 *   EXPECTED_CUSTOMER_ACCOUNT_ID — 12-digit account id
 *   EXPECTED_TENANT_ID — optional tenant id
 */

import { readFileSync, existsSync } from 'node:fs';

import {
  formatExternalIdPresence,
  redactSensitive,
  Sprint13EvidenceValidationError,
  validateDiscoveryEvidence,
  validateRegistrationEvidence,
  validateVerificationEvidence,
} from './lib/sprint-13-production-readiness-evidence';

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`PASS: ${message}`);
}

function loadJsonEnv(name: string): unknown | undefined {
  const path = process.env[name]?.trim();
  if (!path) return undefined;
  if (!existsSync(path)) {
    fail(`${name} path does not exist: [redacted path len=${path.length}]`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function runValidation(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Sprint13EvidenceValidationError) {
      fail(error.message);
    }
    throw error;
  }
}

function main(): void {
  const expectedAccount = process.env.EXPECTED_CUSTOMER_ACCOUNT_ID?.trim();
  const expectedTenant = process.env.EXPECTED_TENANT_ID?.trim();

  if (!expectedAccount) {
    fail('EXPECTED_CUSTOMER_ACCOUNT_ID is required.');
  }
  pass(`Expected customer account id configured (${redactSensitive(expectedAccount)})`);

  if (expectedTenant) {
    pass(`Expected tenant id configured (${redactSensitive(expectedTenant)})`);
  } else {
    console.log('WARN: EXPECTED_TENANT_ID not set — skipping tenant checks in file evidence.');
  }

  const registration = loadJsonEnv('SPRINT13_ACCOUNT_REGISTRATION_RESPONSE');
  const verification = loadJsonEnv('SPRINT13_VERIFICATION_RESPONSE');
  const discovery = loadJsonEnv('SPRINT13_DISCOVERY_RESPONSE');

  if (!registration && !verification && !discovery) {
    fail(
      'At least one of SPRINT13_ACCOUNT_REGISTRATION_RESPONSE, SPRINT13_VERIFICATION_RESPONSE, SPRINT13_DISCOVERY_RESPONSE must point to evidence JSON files.',
    );
  }

  const expectations = {
    expectedAccountId: expectedAccount,
    expectedTenantId: expectedTenant,
  };

  if (registration) {
    runValidation(() => {
      const record = validateRegistrationEvidence(registration, expectations);
      pass('Registration evidence validated.');
      const externalLog = formatExternalIdPresence(record);
      if (externalLog) {
        console.log(`INFO: registration ${externalLog}`);
      }
    });
  }

  if (verification) {
    runValidation(() => {
      const parsed = validateVerificationEvidence(verification, expectations);
      pass('Verification evidence validated.');
      pass(`Verification account version=${parsed.account.version}`);
    });
  }

  if (discovery) {
    runValidation(() => {
      const parsed = validateDiscoveryEvidence(discovery, expectations);
      pass('Discovery evidence validated.');
      pass(`Discovery account version=${parsed.account.version}`);
    });
  }

  if (process.env.SPRINT13_LIVE_VALIDATION?.trim().toLowerCase() === 'true') {
    console.log(
      'INFO: SPRINT13_LIVE_VALIDATION=true — no live HTTP calls are made by this script (evidence files only).',
    );
  }

  pass('Sprint 13 production readiness evidence checks completed (redacted output).');
}

main();
