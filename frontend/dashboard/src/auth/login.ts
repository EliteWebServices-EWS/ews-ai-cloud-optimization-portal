/**
 * Starts Cognito Authorization Code Grant with PKCE.
 */

import { authConfig } from './config';
import {
  generateRandomString,
  createCodeChallenge,
} from './pkce';
import {
  saveOAuthState,
  savePkceVerifier,
  saveReturnPath,
} from './session';

export async function beginLogin(
  returnPath = `${window.location.pathname}${window.location.search}`
): Promise<void> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = generateRandomString(48);

  savePkceVerifier(codeVerifier);
  saveOAuthState(state);
  saveReturnPath(returnPath);

  const parameters = new URLSearchParams({
    client_id: authConfig.clientId,
    response_type: 'code',
    scope: authConfig.scopes.join(' '),
    redirect_uri: authConfig.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.assign(
    `${authConfig.cognitoDomain}/oauth2/authorize?${parameters.toString()}`
  );
}
