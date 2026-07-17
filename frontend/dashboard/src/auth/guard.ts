/**
 * Protects frontend dashboard pages.
 */

import { beginLogin } from './login';
import {
  getSession,
  getValidAccessToken,
  storeSession,
  type CognitoTokenResponse,
} from './session';
import { authConfig } from './config';

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const session = getSession();

  if (!session?.refreshToken) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: authConfig.clientId,
    refresh_token: session.refreshToken,
  });

  const response = await fetch(
    `${authConfig.cognitoDomain}/oauth2/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  );

  if (!response.ok) {
    return null;
  }

  const refreshedTokens =
    (await response.json()) as CognitoTokenResponse;

  const updatedTokens: CognitoTokenResponse = {
    ...refreshedTokens,
    refresh_token:
      refreshedTokens.refresh_token ?? session.refreshToken,
  };

  return storeSession(updatedTokens).accessToken;
}

export async function getOrRefreshAccessToken(): Promise<string | null> {
  const currentToken = getValidAccessToken();

  if (currentToken) {
    return currentToken;
  }

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function requireAuthentication(): Promise<string> {
  const accessToken = await getOrRefreshAccessToken();

  if (accessToken) {
    return accessToken;
  }

  await beginLogin();
  throw new Error('Redirecting to sign-in.');
}
