import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import serverlessExpress from '@codegenie/serverless-express';
import { extractTrustedTenantClaim } from './auth/tenant-claims';
import {
  isAcceptedSessionMfaVerifiedClaim,
  SESSION_MFA_VERIFIED_ACCESS_TOKEN_CLAIM,
} from './auth/privileged-mfa';
import {
  stripUntrustedIdentityHeaders,
} from './auth/internal-identity-headers';
import { createApp } from './index';

interface JwtAuthorizerContext {
  claims?: Record<string, unknown>;
  scopes?: string[] | null;
}

interface AuthenticatedRequestContext {
  authorizer?: {
    jwt?: JwtAuthorizerContext;
  };
}

interface AuthenticatedHttpApiEvent extends APIGatewayProxyEventV2 {
  requestContext: APIGatewayProxyEventV2['requestContext'] &
    AuthenticatedRequestContext;
}

type PromiseServerlessExpressHandler = (
  event: AuthenticatedHttpApiEvent,
  context: Context
) => Promise<APIGatewayProxyResultV2>;

const app = createApp({ identitySource: 'lambda-adapter' });

const serverlessExpressHandler = serverlessExpress({
  app,
}) as unknown as PromiseServerlessExpressHandler;

const SESSION_MFA_HEADER_CANONICAL = 'x-sisum-mfa-session-verified';

/**
 * Copy API Gateway-validated Cognito claims into internal request headers.
 *
 * Client-supplied internal identity headers are removed before trusted values
 * from API Gateway JWT claims are added.
 */
export function attachValidatedIdentityHeaders(
  event: AuthenticatedHttpApiEvent
): void {
  const claims = event.requestContext.authorizer?.jwt?.claims;

  event.headers = {
    ...(event.headers ?? {}),
  };

  stripUntrustedIdentityHeaders(
    event.headers as Record<string, string | string[] | undefined>,
  );

  if (!claims) {
    return;
  }

  const tokenUse = String(claims.token_use ?? '').trim();

  /*
   * API Gateway validates access tokens. Reject other token_use values
   * before copying identity headers into the Express request context.
   */
  if (tokenUse && tokenUse !== 'access') {
    return;
  }

  const groups = String(
    claims['cognito:groups'] ?? claims.groups ?? '',
  );

  const userId = String(
    claims.sub ?? claims['cognito:username'] ?? '',
  );

  const email = String(claims.email ?? '').trim();
  const normalizedClientId = claims.client_id ?? claims.aud ?? '';

  const clientId =
    typeof normalizedClientId === 'string'
      ? normalizedClientId.trim()
      : String(normalizedClientId ?? '').trim();

  if (!userId.trim()) {
    return;
  }

  event.headers['x-sisum-authenticated'] = 'true';
  event.headers['x-sisum-user-id'] = userId.trim();
  event.headers['x-sisum-user-email'] = email;
  event.headers['x-sisum-user-groups'] = groups;
  event.headers['x-sisum-token-use'] = tokenUse || 'access';
  event.headers['x-sisum-client-id'] = clientId;

  const tenantClaim = extractTrustedTenantClaim(
    claims as Record<string, string | undefined>,
  );

  if (tenantClaim) {
    event.headers['x-sisum-tenant-id'] = tenantClaim;
  }

  const sessionMfaClaim = claims[SESSION_MFA_VERIFIED_ACCESS_TOKEN_CLAIM];

  if (isAcceptedSessionMfaVerifiedClaim(sessionMfaClaim)) {
    event.headers[SESSION_MFA_HEADER_CANONICAL] = 'true';
  }
}

/**
 * Node.js 24-compatible asynchronous Lambda entry point.
 */
export async function handler(
  event: AuthenticatedHttpApiEvent,
  context: Context
): Promise<APIGatewayProxyResultV2> {
  attachValidatedIdentityHeaders(event);

  return serverlessExpressHandler(event, context);
}