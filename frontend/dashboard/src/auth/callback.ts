/**
 * Cognito OAuth callback handler.
 */

import { authConfig } from './config';
import {
  storeSession,
  takeOAuthState,
  takePkceVerifier,
  takeReturnPath,
  type CognitoTokenResponse,
} from './session';

function setStatus(message: string, isError = false): void {
  const statusElement = document.getElementById('auth-status');

  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
  statusElement.classList.toggle('auth-error', isError);
}

async function exchangeCodeForTokens(
  authorizationCode: string,
  codeVerifier: string
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: authConfig.clientId,
    code: authorizationCode,
    redirect_uri: authConfig.redirectUri,
    code_verifier: codeVerifier,
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
    const responseText = await response.text();
    throw new Error(
      `Cognito token exchange failed (${response.status}): ${responseText}`
    );
  }

  return (await response.json()) as CognitoTokenResponse;
}

async function handleCallback(): Promise<void> {
  try {
    const query = new URLSearchParams(window.location.search);

    const oauthError = query.get('error');
    const oauthErrorDescription = query.get('error_description');

    if (oauthError) {
      throw new Error(
        oauthErrorDescription
          ? `${oauthError}: ${oauthErrorDescription}`
          : oauthError
      );
    }

    const authorizationCode = query.get('code');
    const returnedState = query.get('state');

    if (!authorizationCode) {
      throw new Error('Authorization code is missing from the callback.');
    }

    if (!returnedState) {
      throw new Error('OAuth state is missing from the callback.');
    }

    const expectedState = takeOAuthState();

    if (!expectedState || returnedState !== expectedState) {
      throw new Error(
        'The login response could not be verified. Please sign in again.'
      );
    }

    const codeVerifier = takePkceVerifier();

    if (!codeVerifier) {
      throw new Error(
        'The PKCE verifier is missing. Please sign in again.'
      );
    }

    setStatus('Completing secure sign-in…');

    const tokens = await exchangeCodeForTokens(
      authorizationCode,
      codeVerifier
    );

    storeSession(tokens);

    const returnPath = takeReturnPath();
    window.location.replace(returnPath);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'An unexpected authentication error occurred.';

    console.error('Authentication callback failed:', error);
    setStatus(message, true);

    const retryLink =
      document.querySelector<HTMLAnchorElement>('#retry-login');

    if (retryLink) {
      retryLink.hidden = false;
    }
  }
}

void handleCallback();
