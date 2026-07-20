import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import serverlessExpress from '@codegenie/serverless-express';
import { extractTrustedTenantClaim } from './auth/tenant-claims';
import { createApp } from './index';

interface JwtAuthorizerContext {
  claims?: Record<string, string | undefined>;
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

const app = createApp();

const serverlessExpressHandler = serverlessExpress({
  app,
}) as unknown as PromiseServerlessExpressHandler;

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

  delete event.headers['x-sisum-authenticated'];
  delete event.headers['x-sisum-user-id'];
  delete event.headers['x-sisum-user-email'];
  delete event.headers['x-sisum-user-groups'];
  delete event.headers['x-sisum-token-use'];
  delete event.headers['x-sisum-client-id'];
  delete event.headers['x-sisum-tenant-id'];
  delete event.headers['x-tenant-id'];

  if (!claims) {
    return;
  }

  const tokenUse = (claims.token_use ?? '').trim();

  /*
   * API Gateway validates access tokens. Reject other token_use values
   * before copying identity headers into the Express request context.
   */
  if (tokenUse && tokenUse !== 'access') {
    return;
  }

  const groups =
    claims['cognito:groups'] ??
    claims.groups ??
    '';

  const userId =
    claims.sub ??
    claims['cognito:username'] ??
    '';

  const email = (claims.email ?? '').trim();
  const normalizedClientId =
    claims.client_id ??
    claims.aud ??
    '';

  const clientId =
    typeof normalizedClientId === 'string'
      ? normalizedClientId.trim()
      : '';

  if (!userId.trim()) {
    return;
  }

  event.headers['x-sisum-authenticated'] = 'true';
  event.headers['x-sisum-user-id'] = userId.trim();
  event.headers['x-sisum-user-email'] = email;
  event.headers['x-sisum-user-groups'] = groups;
  event.headers['x-sisum-token-use'] = tokenUse || 'access';
  event.headers['x-sisum-client-id'] = clientId;

  const tenantClaim = extractTrustedTenantClaim(claims);

  if (tenantClaim) {
    event.headers['x-sisum-tenant-id'] = tenantClaim;
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