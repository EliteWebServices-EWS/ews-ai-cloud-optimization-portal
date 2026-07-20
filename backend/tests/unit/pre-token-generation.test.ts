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
  request: {
    userAttributes: Record<string, string | undefined>;
    clientMetadata?: Record<string, string | undefined>;
  };
  response?: {
    claimsAndScopeOverrideDetails?: {
      accessTokenGeneration?: {
        claimsToAddOrOverride?: Record<string, string>;
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

function loadDeployedHandler(): (
  event: PreTokenEvent
) => Promise<PreTokenEvent> {
  const source = extractDeployedHandlerSource();
  const context = createContext({
    exports: {} as { handler?: (event: PreTokenEvent) => Promise<PreTokenEvent> },
    module: {
      exports: {} as { handler?: (event: PreTokenEvent) => Promise<PreTokenEvent> },
    },
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
    tenantAttribute?: string;
    clientMetadataTenant?: string;
    existingClaims?: Record<string, string>;
    existingScopes?: string[];
  } = {}
): PreTokenEvent {
  const attributes: Record<string, string | undefined> = {};

  if (overrides.tenantAttribute !== undefined) {
    attributes['custom:tenantId'] = overrides.tenantAttribute;
  }

  return {
    request: {
      userAttributes: attributes,
      clientMetadata: overrides.clientMetadataTenant
        ? { tenantId: overrides.clientMetadataTenant }
        : undefined,
    },
    response: {
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: overrides.existingClaims ?? {
            existing_claim: 'keep-me',
          },
          scopesToAdd: overrides.existingScopes ?? [
            'openid',
            'email',
          ],
          scopesToSuppress: ['suppress-me'],
        },
      },
    },
  };
}

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