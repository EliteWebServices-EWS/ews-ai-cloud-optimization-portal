/**
 * Clears the local SISUM session and ends the Cognito managed-login session.
 */

import { authConfig } from './config';
import { clearSession } from './session';

export function logout(): void {
  clearSession();

  const parameters = new URLSearchParams({
    client_id: authConfig.clientId,
    logout_uri: authConfig.logoutUri,
  });

  window.location.assign(
    `${authConfig.cognitoDomain}/logout?${parameters.toString()}`
  );
}

export function attachLogoutButton(buttonId = 'logout-btn'): void {
  const button =
    document.getElementById(buttonId) as HTMLButtonElement | null;

  if (!button) {
    return;
  }

  button.addEventListener('click', logout);
}
