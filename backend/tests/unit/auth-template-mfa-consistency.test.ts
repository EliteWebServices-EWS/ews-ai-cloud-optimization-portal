import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  loadAuthTemplate,
  requireResourceProperties,
} from '../helpers/cfn-auth-template-loader';

const AUTH_TEMPLATE_SOURCE_PATH = path.resolve(
  __dirname,
  '../../../infrastructure/auth/template.yaml',
);

function sisumUserPoolTemplateBlock(source: string): string {
  return source.slice(
    source.indexOf('SisumUserPool:'),
    source.indexOf('SisumPreTokenGenerationRole:'),
  );
}

function assertMfaConfigurationQuotedOnInSource(source: string): void {
  const poolBlock = sisumUserPoolTemplateBlock(source);

  assert.doesNotMatch(
    poolBlock,
    /^\s*MfaConfiguration:\s*ON\s*$/m,
    'MfaConfiguration must not be unquoted ON (YAML 1.1 boolean hazard)',
  );
  assert.doesNotMatch(
    poolBlock,
    /^\s*MfaConfiguration:\s*true\s*$/im,
    'MfaConfiguration must not be boolean true',
  );
  assert.match(
    poolBlock,
    /^\s*MfaConfiguration:\s*['"]ON['"]\s*$/m,
    'MfaConfiguration must be quoted string ON for CloudFormation',
  );
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${field} must be a string, got ${typeof value}`);
  }
  return value;
}

function readStringArray(value: unknown, field: string): string[] {
  assert.ok(Array.isArray(value), `${field} must be an array`);
  for (const entry of value) {
    assert.equal(typeof entry, 'string', `${field} entries must be strings`);
  }
  return value;
}

function readEnvironmentVariables(
  properties: Record<string, unknown>,
): Record<string, string> {
  const environment = properties.Environment;

  assert.ok(
    environment && typeof environment === 'object' && !Array.isArray(environment),
    'SisumPreTokenGenerationFunction.Properties.Environment must be an object',
  );

  const variables = (environment as Record<string, unknown>).Variables;

  assert.ok(
    variables && typeof variables === 'object' && !Array.isArray(variables),
    'Environment.Variables must be an object',
  );

  const normalized: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(
    variables as Record<string, unknown>,
  )) {
    assert.equal(
      typeof rawValue,
      'string',
      `Environment.Variables.${key} must be a string`,
    );
    normalized[key] = rawValue as string;
  }

  return normalized;
}

describe('Auth template MFA policy and Lambda gate consistency', () => {
  const template = loadAuthTemplate();

  it('requires SisumUserPool MfaConfiguration ON and SOFTWARE_TOKEN_MFA', () => {
    const poolProps = requireResourceProperties(template, 'SisumUserPool');

    assert.equal(readString(poolProps.MfaConfiguration, 'MfaConfiguration'), 'ON');
    assert.notEqual(poolProps.MfaConfiguration, true);

    const enabledMfas = readStringArray(
      poolProps.EnabledMfas,
      'EnabledMfas',
    );

    assert.ok(
      enabledMfas.includes('SOFTWARE_TOKEN_MFA'),
      'EnabledMfas must include SOFTWARE_TOKEN_MFA',
    );
  });

  it('quotes MfaConfiguration ON in template source for CloudFormation', () => {
    const source = readFileSync(AUTH_TEMPLATE_SOURCE_PATH, 'utf8');
    assertMfaConfigurationQuotedOnInSource(source);
  });

  it('sets COGNITO_REQUIRED_MFA Lambda environment gate to string true', () => {
    const lambdaProps = requireResourceProperties(
      template,
      'SisumPreTokenGenerationFunction',
    );
    const variables = readEnvironmentVariables(lambdaProps);

    assert.equal(variables.COGNITO_REQUIRED_MFA, 'true');
  });

  it('keeps pool MFA ON and COGNITO_REQUIRED_MFA true in bidirectional lockstep', () => {
    const poolProps = requireResourceProperties(template, 'SisumUserPool');
    const lambdaProps = requireResourceProperties(
      template,
      'SisumPreTokenGenerationFunction',
    );
    const variables = readEnvironmentVariables(lambdaProps);

    const mfaConfiguration = readString(
      poolProps.MfaConfiguration,
      'MfaConfiguration',
    );
    const requiredMfaGate = variables.COGNITO_REQUIRED_MFA ?? '';
    const gateIsTrue = requiredMfaGate === 'true';
    const poolRequiresMfa = mfaConfiguration === 'ON';

    assert.equal(
      gateIsTrue,
      poolRequiresMfa,
      'COGNITO_REQUIRED_MFA=true must match MfaConfiguration=ON (both directions)',
    );

    if (gateIsTrue) {
      assert.equal(mfaConfiguration, 'ON');
    }

    if (poolRequiresMfa) {
      assert.equal(requiredMfaGate, 'true');
    }
  });

  it('keeps SupportedIdentityProviders exactly COGNITO for managed login MFA architecture', () => {
    const clientProps = requireResourceProperties(template, 'SisumUserPoolClient');
    const providers = readStringArray(
      clientProps.SupportedIdentityProviders,
      'SupportedIdentityProviders',
    );

    assert.deepEqual(providers, ['COGNITO']);
  });
});
