/**
 * Tests for the deployed Cognito Pre Token Generation inline Lambda.
 *
 * Loads handler source from infrastructure/auth/template.yaml ZipFile so tests
 * exercise the implementation CloudFormation actually deploys.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, it } from 'node:test';

const AUTH_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../infrastructure/auth/template.yaml'
);

interface PreTokenEvent {
  triggerSource?: string;
  request: {
    userAttributes: Record<string, string | undefined>;
    clientMetadata?: Record<string, string | undefined>;
  };
  response?: {
    claimsAndScopeOverrideDetails?: {
      accessTokenGeneration?: {
        claimsToAddOrOverride?: Record<string, string | boolean>;
        scopesToAdd?: string[];
        scopesToSuppress?: string[];
        claimsToSuppress?: string[];
      };
    };
  };
}

function extractDeployedHandlerSource(): string {
  const template = readFileSync(AUTH_TEMPLATE_PATH, 'utf8');
  const zipMarker = 'ZipFile: |';
  const zipStart = template.indexOf(zipMarker);

  if (zipStart === -1) {
    throw new Error('Pre Token Generation ZipFile not found in auth template.');
  }

  const afterMarker = template.slice(zipStart + zipMarker.length);
  const lines = afterMarker.split('\n');
  const codeLines: string[] = [];
  let baseIndent: number | null = null;

  for (const line of lines) {
    if (/^  SisumPreTokenGenerationPermission:/.test(line)) {
      break;
    }

    if (line.trim().length === 0) {
      if (codeLines.length > 0) {
        codeLines.push('');
      }
      continue;
    }

    const indentMatch = line.match(/^(\s+)\S/);

    if (!indentMatch) {
      if (codeLines.length > 0) {
        break;
      }
      continue;
    }

    const indent = indentMatch[1].length;

    if (baseIndent === null) {
      baseIndent = indent;
    }

    if (indent < baseIndent) {
      break;
    }

    codeLines.push(line.slice(baseIndent));
  }

  if (codeLines.length === 0) {
    throw new Error('Pre Token Generation ZipFile body is empty.');
  }

  return codeLines.join('\n').trimEnd();
}

function loadDeployedHandler(
  options: { cognitoRequiredMfa?: boolean } = {},
): (event: PreTokenEvent) => Promise<PreTokenEvent> {
  const source = extractDeployedHandlerSource();
  const env: Record<string, string | undefined> = {};

  if (options.cognitoRequiredMfa === true) {
    env.COGNITO_REQUIRED_MFA = 'true';
  } else if (options.cognitoRequiredMfa === false) {
    env.COGNITO_REQUIRED_MFA = 'false';
  }

  const context = createContext({
    exports: {} as { handler?: (event: PreTokenEvent) => Promise<PreTokenEvent> },
    module: {
      exports: {} as { handler?: (event: PreTokenEvent) => Promise<PreTokenEvent> },
    },
    process: { env },
  });

  context.module.exports = context.exports;
  runInContext(source, context);

  const handler = context.exports.handler;

  if (typeof handler !== 'function') {
    throw new Error('Deployed Pre Token Generation handler was not exported.');
  }

  return handler;
}

function buildEvent(
  overrides: {
    triggerSource?: string;
    tenantAttribute?: string;
    clientMetadataTenant?: string;
    clientMetadata?: Record<string, string>;
    existingClaims?: Record<string, string | boolean>;
    existingScopes?: string[];
    includeResponse?: boolean;
    userAttributes?: Record<string, string | undefined>;
  } = {}
): PreTokenEvent {
  const attributes: Record<string, string | undefined> = {
    ...(overrides.userAttributes ?? {}),
  };

  if (overrides.tenantAttribute !== undefined) {
    attributes['custom:tenantId'] = overrides.tenantAttribute;
  }

  const event: PreTokenEvent = {
    triggerSource: overrides.triggerSource,
    request: {
      userAttributes: attributes,
      clientMetadata:
        overrides.clientMetadata ??
        (overrides.clientMetadataTenant
          ? { tenantId: overrides.clientMetadataTenant }
          : undefined),
    },
  };

  if (overrides.includeResponse !== false) {
    event.response = {
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: overrides.existingClaims ?? {
            existing_claim: 'keep-me',
          },
          scopesToAdd: overrides.existingScopes ?? ['openid', 'email'],
          scopesToSuppress: ['suppress-me'],
        },
      },
    };
  }

  return event;
}

const HOSTED_AUTH = 'TokenGeneration_HostedAuth';
const REFRESH = 'TokenGeneration_RefreshTokens';

describe('Deployed Pre Token Generation handler', () => {
  const handler = loadDeployedHandler();

  it('adds tenant_id when custom:tenantId is valid', async () => {
    const result = await handler(
      buildEvent({ tenantAttribute: 'sisum-default' })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      'sisum-default'
    );
  });

  it('returns unchanged event when custom:tenantId is missing', async () => {
    const event = buildEvent();
    const result = await handler(event);

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('rejects uppercase tenant values', async () => {
    const result = await handler(
      buildEvent({ tenantAttribute: 'TENANT-A' })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('rejects tenant values containing spaces', async () => {
    const result = await handler(
      buildEvent({ tenantAttribute: 'tenant a' })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('rejects slash and path-like tenant values', async () => {
    const result = await handler(
      buildEvent({ tenantAttribute: '../tenant' })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('rejects leading hyphen tenant values', async () => {
    const result = await handler(
      buildEvent({ tenantAttribute: '-tenant' })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('rejects trailing hyphen tenant values', async () => {
    const result = await handler(
      buildEvent({ tenantAttribute: 'tenant-' })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('accepts one-character lowercase alphanumeric tenant IDs', async () => {
    const result = await handler(buildEvent({ tenantAttribute: 'a' }));

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      'a'
    );
  });

  it('accepts maximum 64-character valid tenant IDs', async () => {
    const tenantId = `a${'b'.repeat(62)}c`;

    assert.equal(tenantId.length, 64);

    const result = await handler(buildEvent({ tenantAttribute: tenantId }));

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      tenantId
    );
  });

  it('rejects tenant IDs longer than 64 characters', async () => {
    const tenantId = 'a'.repeat(65);

    assert.equal(tenantId.length, 65);

    const result = await handler(
      buildEvent({
        tenantAttribute: tenantId,
      })
    );

    const tenantClaim =
      result.response
        ?.claimsAndScopeOverrideDetails
        ?.accessTokenGeneration
        ?.claimsToAddOrOverride
        ?.tenant_id;

    assert.equal(tenantClaim, undefined);
  });

  it('rejects tenant IDs longer than 64 characters', async () => {
    const tenantId = `a${'b'.repeat(63)}c`;

    assert.equal(tenantId.length, 65);

    const result = await handler(buildEvent({ tenantAttribute: tenantId }));

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      undefined
    );
  });

  it('preserves existing access-token claims when adding tenant_id', async () => {
    const result = await handler(
      buildEvent({
        tenantAttribute: 'tenant-acme',
        existingClaims: { existing_claim: 'keep-me' },
      })
    );

    const claims =
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride;

    assert.equal(claims?.existing_claim, 'keep-me');
    assert.equal(claims?.tenant_id, 'tenant-acme');
  });

  it('preserves existing scopes when adding tenant_id', async () => {
    const result = await handler(
      buildEvent({
        tenantAttribute: 'tenant-001',
        existingScopes: ['openid', 'profile'],
      })
    );

    const accessTokenGeneration =
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration;

    assert.deepEqual(accessTokenGeneration?.scopesToAdd, [
      'openid',
      'profile',
    ]);
    assert.deepEqual(accessTokenGeneration?.scopesToSuppress, [
      'suppress-me',
    ]);
  });

  it('ignores clientMetadata tenant overrides', async () => {
    const result = await handler(
      buildEvent({
        tenantAttribute: 'sisum-default',
        clientMetadataTenant: 'metadata-spoof',
      })
    );

    assert.equal(
      result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride?.tenant_id,
      'sisum-default'
    );
  });
});

describe('Pre Token Generation MFA session assurance', () => {
  const handler = loadDeployedHandler({ cognitoRequiredMfa: true });

  function accessClaims(result: PreTokenEvent) {
    return result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
      ?.claimsToAddOrOverride;
  }

  function accessSuppress(result: PreTokenEvent) {
    return result.response?.claimsAndScopeOverrideDetails?.accessTokenGeneration
      ?.claimsToSuppress;
  }

  it('TokenGeneration_HostedAuth adds mfa_session_verified and valid tenant_id', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
        tenantAttribute: 'sisum-default',
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, 'sisum-default');
    assert.equal(claims?.mfa_session_verified, true);
  });

  it('TokenGeneration_HostedAuth adds mfa_session_verified when tenantId is absent', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, undefined);
    assert.equal(claims?.mfa_session_verified, true);
  });

  it('TokenGeneration_HostedAuth adds mfa_session_verified and omits invalid tenant_id', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
        tenantAttribute: 'INVALID',
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, undefined);
    assert.equal(claims?.mfa_session_verified, true);
  });

  it('TokenGeneration_RefreshTokens suppresses mfa_session_verified and keeps tenant_id', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: REFRESH,
        tenantAttribute: 'sisum-default',
        existingClaims: {
          existing_claim: 'keep-me',
          mfa_session_verified: true,
        },
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, 'sisum-default');
    assert.equal(claims?.mfa_session_verified, undefined);
    assert.ok(accessSuppress(result)?.includes('mfa_session_verified'));
  });

  it('unknown trigger source does not add mfa_session_verified', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: 'TokenGeneration_Authentication',
        tenantAttribute: 'sisum-default',
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, 'sisum-default');
    assert.equal(claims?.mfa_session_verified, undefined);
  });

  it('ignores clientMetadata mfa_session_verified on non-hosted triggers', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: 'TokenGeneration_Unknown',
        tenantAttribute: 'sisum-default',
        clientMetadata: { mfa_session_verified: 'true' },
      })
    );

    assert.equal(accessClaims(result)?.mfa_session_verified, undefined);
  });

  it('ignores custom user attribute that looks like MFA assurance', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: 'TokenGeneration_Unknown',
        userAttributes: {
          'custom:tenantId': 'sisum-default',
          'custom:mfa_session_verified': 'true',
        },
      })
    );

    assert.equal(accessClaims(result)?.mfa_session_verified, undefined);
    assert.equal(accessClaims(result)?.tenant_id, 'sisum-default');
  });

  it('admin group membership on profile does not affect assurance logic alone', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: 'TokenGeneration_Unknown',
        userAttributes: {
          'custom:tenantId': 'sisum-default',
          'cognito:groups': 'admin',
        },
      })
    );

    assert.equal(accessClaims(result)?.mfa_session_verified, undefined);
  });

  it('preserves unrelated claims on HostedAuth', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
        tenantAttribute: 'tenant-acme',
        existingClaims: { existing_claim: 'keep-me' },
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.existing_claim, 'keep-me');
    assert.equal(claims?.mfa_session_verified, true);
  });

  it('handles missing nested response objects on HostedAuth', async () => {
    const result = await handler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
        tenantAttribute: 'a',
        includeResponse: false,
      })
    );

    assert.equal(accessClaims(result)?.tenant_id, 'a');
    assert.equal(accessClaims(result)?.mfa_session_verified, true);
  });

  it('TokenGeneration_HostedAuth does not emit mfa_session_verified when COGNITO_REQUIRED_MFA is false', async () => {
    const disabledHandler = loadDeployedHandler({ cognitoRequiredMfa: false });
    const result = await disabledHandler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
        tenantAttribute: 'sisum-default',
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, 'sisum-default');
    assert.equal(claims?.mfa_session_verified, undefined);
  });

  it('TokenGeneration_HostedAuth does not emit mfa_session_verified when COGNITO_REQUIRED_MFA is unset', async () => {
    const unsetHandler = loadDeployedHandler();
    const result = await unsetHandler(
      buildEvent({
        triggerSource: HOSTED_AUTH,
        tenantAttribute: 'sisum-default',
      })
    );

    const claims = accessClaims(result);
    assert.equal(claims?.tenant_id, 'sisum-default');
    assert.equal(claims?.mfa_session_verified, undefined);
  });
});

describe('Auth template Pre Token Generation infrastructure', () => {
  const template = readFileSync(AUTH_TEMPLATE_PATH, 'utf8');

  it('uses LambdaVersion V2_0', () => {
    assert.match(template, /LambdaVersion:\s*V2_0/);
  });

  it('does not use legacy PreTokenGeneration property', () => {
    assert.doesNotMatch(
      template,
      /^\s*PreTokenGeneration:\s*!/m
    );
  });

  it('restricts Lambda permission with SourceAccount', () => {
    assert.match(template, /SourceAccount:\s*!Ref AWS::AccountId/);
  });

  it('does not bind Lambda permission to user pool SourceArn', () => {
    const permissionBlock = template.slice(
      template.indexOf('SisumPreTokenGenerationPermission:')
    );

    assert.doesNotMatch(permissionBlock, /SourceArn:/);
  });

  it('makes Cognito user pool depend on Lambda permission', () => {
    const userPoolBlock = template.slice(
      template.indexOf('SisumUserPool:'),
      template.indexOf('SisumPreTokenGenerationRole:')
    );

    assert.match(userPoolBlock, /DependsOn:\s*\n\s*- SisumPreTokenGenerationPermission/);
  });

  it('does not allow SPA WriteAttributes on custom tenant attribute', () => {
    const clientBlock = template.slice(
      template.indexOf('SisumUserPoolClient:'),
      template.indexOf('SisumUserPoolDomain:')
    );

    assert.match(clientBlock, /WriteAttributes:\s*\n\s*- email/);
    assert.doesNotMatch(clientBlock, /custom:tenantId/);
  });

  it('does not contain circular permission dependency on user pool', () => {
    const permissionBlock = template.slice(
      template.indexOf('SisumPreTokenGenerationPermission:'),
      template.indexOf('SisumUserPoolClient:')
    );

    assert.doesNotMatch(permissionBlock, /DependsOn:/);
    assert.doesNotMatch(permissionBlock, /SisumUserPool/);
  });
});

describe('Auth template Cognito MFA and recovery', () => {
  const template = readFileSync(AUTH_TEMPLATE_PATH, 'utf8');

  function userPoolBlock(): string {
    return template.slice(
      template.indexOf('SisumUserPool:'),
      template.indexOf('SisumPreTokenGenerationRole:')
    );
  }

  function userPoolClientBlock(): string {
    return template.slice(
      template.indexOf('SisumUserPoolClient:'),
      template.indexOf('SisumUserPoolDomain:')
    );
  }

  it('requires software-token MFA and disables SMS MFA', () => {
    const pool = userPoolBlock();

    assert.match(pool, /MfaConfiguration:\s*['"]ON['"]/);
    assert.match(pool, /EnabledMfas:\s*\n\s*- SOFTWARE_TOKEN_MFA/);
    assert.doesNotMatch(pool, /SMS_MFA/);
    assert.doesNotMatch(pool, /EMAIL_OTP/);
  });

  it('uses verified email account recovery', () => {
    const pool = userPoolBlock();

    assert.match(pool, /AccountRecoverySetting:/);
    assert.match(pool, /RecoveryMechanisms:/);
    assert.match(pool, /Name:\s*verified_email/);
    assert.match(pool, /Priority:\s*1/);
    assert.doesNotMatch(pool, /verified_phone_number/);
  });

  it('retains custom tenantId schema and pre-token-generation trigger', () => {
    const pool = userPoolBlock();

    assert.match(pool, /Name:\s*tenantId/);
    assert.match(pool, /PreTokenGenerationConfig:/);
    assert.match(pool, /LambdaVersion:\s*V2_0/);
    assert.match(pool, /LambdaArn:\s*!GetAtt SisumPreTokenGenerationFunction\.Arn/);
  });

  it('inline pre-token Lambda references hosted-auth assurance trigger', () => {
    const zipStart = template.indexOf('ZipFile: |');
    const zipBody = template.slice(
      zipStart,
      template.indexOf('SisumPreTokenGenerationPermission:')
    );

    assert.match(zipBody, /TokenGeneration_HostedAuth/);
    assert.match(zipBody, /TokenGeneration_RefreshTokens/);
    assert.match(zipBody, /mfa_session_verified/);
    assert.match(zipBody, /COGNITO_REQUIRED_MFA/);
    assert.match(zipBody, /isRequiredMfaDeploymentEnabled/);
  });

  it('pre-token Lambda sets COGNITO_REQUIRED_MFA environment variable', () => {
    const fnBlock = template.slice(
      template.indexOf('SisumPreTokenGenerationFunction:'),
      template.indexOf('SisumPreTokenGenerationPermission:')
    );

    assert.match(fnBlock, /COGNITO_REQUIRED_MFA:\s*'true'/);
  });

  it('preserves SPA OAuth callback and logout URLs', () => {
    const client = userPoolClientBlock();

    assert.match(
      client,
      /https:\/\/\$\{PrimaryDomainName\}\/dashboard\/auth\/callback\.html/
    );
    assert.match(
      client,
      /https:\/\/www\.\$\{PrimaryDomainName\}\/dashboard\/auth\/callback\.html/
    );
    assert.match(client, /http:\/\/localhost:5173\/dashboard\/auth\/callback\.html/);
    assert.match(client, /https:\/\/\$\{PrimaryDomainName\}\//);
    assert.match(client, /http:\/\/localhost:5173\//);
    assert.match(client, /- openid/);
    assert.match(client, /- aws\.cognito\.signin\.user\.admin/);
  });
});