/**
 * Amazon Cognito authentication configuration.
 *
 * These values identify public frontend resources. They are not passwords
 * or application secrets.
 */

const COGNITO_DOMAIN =
  import.meta.env.VITE_COGNITO_DOMAIN ??
  'https://sisum-production-739275446782.auth.us-east-1.amazoncognito.com';

const CLIENT_ID =
  import.meta.env.VITE_COGNITO_CLIENT_ID ??
  '1dc1g0tkflsspjd7uc6n131jft';

const PRODUCTION_REDIRECT_URI =
  'https://elitewebservices.org/dashboard/auth/callback.html';

const LOCAL_REDIRECT_URI =
  'http://localhost:5173/dashboard/auth/callback.html';

const PRODUCTION_LOGOUT_URI = 'https://elitewebservices.org/';
const LOCAL_LOGOUT_URI = 'http://localhost:5173/';

function isLocalEnvironment(): boolean {
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}

export const authConfig = {
  cognitoDomain: COGNITO_DOMAIN.replace(/\/+$/, ''),
  clientId: CLIENT_ID,
  redirectUri: isLocalEnvironment()
    ? LOCAL_REDIRECT_URI
    : PRODUCTION_REDIRECT_URI,
  logoutUri: isLocalEnvironment()
    ? LOCAL_LOGOUT_URI
    : PRODUCTION_LOGOUT_URI,
  scopes: ['openid', 'email', 'profile'],
} as const;
