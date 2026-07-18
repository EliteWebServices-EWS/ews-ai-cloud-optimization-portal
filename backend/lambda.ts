import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Callback,
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

const app = createApp();
const serverlessExpressHandler = serverlessExpress({ app });

/**
 * Copy API Gateway-validated Cognito claims into internal request headers.
 *
 * Any client-supplied versions of these headers are deleted first. The values
 * used by Express RBAC middleware therefore come only from the JWT claims that
 * API Gateway has already validated.
 */
function attachValidatedIdentityHeaders(
  event: AuthenticatedHttpApiEvent
): void {
  const claims = event.requestContext.authorizer?.jwt?.claims;

  event.headers = {
    ...(event.headers ?? {}),
  };

  // Remove any client-supplied internal identity headers.
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
  const clientId = claims.client_id ?? claims.aud ?? '';

  event.headers['x-sisum-authenticated'] = 'true';
  event.headers['x-sisum-user-id'] = userId;
  event.headers['x-sisum-user-email'] = email;
  event.headers['x-sisum-user-groups'] = groups;
  event.headers['x-sisum-token-use'] = tokenUse;
  event.headers['x-sisum-client-id'] = clientId;
}

/**
 * AWS Lambda entry point.
 *
 * The callback is passed through because serverless-express v5 uses the
 * standard three-argument AWS Lambda handler signature.
 */
export function handler(
  event: AuthenticatedHttpApiEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResultV2>
): void | Promise<APIGatewayProxyResultV2> {
  attachValidatedIdentityHeaders(event);

  return serverlessExpressHandler(
    event,
    context,
    callback
  ) as void | Promise<APIGatewayProxyResultV2>;
}