import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import serverlessExpress from '@codegenie/serverless-express';
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

/**
 * Promise-based serverless-express handler shape used by Node.js 24.
 *
 * Some installed type declarations describe the traditional callback
 * signature even though serverless-express uses Promise resolution by default.
 */
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
function attachValidatedIdentityHeaders(
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

  if (!claims) {
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

  const email = claims.email ?? '';
  const tokenUse = claims.token_use ?? '';

  const clientId =
    claims.client_id ??
    claims.aud ??
    '';

  event.headers['x-sisum-authenticated'] = 'true';
  event.headers['x-sisum-user-id'] = userId;
  event.headers['x-sisum-user-email'] = email;
  event.headers['x-sisum-user-groups'] = groups;
  event.headers['x-sisum-token-use'] = tokenUse;
  event.headers['x-sisum-client-id'] = clientId;
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