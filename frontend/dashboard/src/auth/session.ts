/**
 * Cognito token and browser-session management.
 */

const TOKEN_STORAGE_KEY = 'sisum.auth.tokens';
const PKCE_VERIFIER_KEY = 'sisum.auth.pkceVerifier';
const OAUTH_STATE_KEY = 'sisum.auth.oauthState';
const RETURN_PATH_KEY = 'sisum.auth.returnPath';

export interface CognitoTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface StoredSession {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt: number;
}

interface JwtPayload {
  exp?: number;
  email?: string;
  username?: string;
  'cognito:username'?: string;
  'cognito:groups'?: string[];
  token_use?: string;
  client_id?: string;
  aud?: string;
  [key: string]: unknown;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized.padEnd(
    normalized.length + paddingLength,
    '='
  );

  return window.atob(padded);
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');

    if (parts.length !== 3) {
      return null;
    }

    return JSON.parse(decodeBase64Url(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

export function storeSession(tokens: CognitoTokenResponse): StoredSession {
  const session: StoredSession = {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };

  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getSession(): StoredSession | null {
  const storedValue = sessionStorage.getItem(TOKEN_STORAGE_KEY);

  if (!storedValue) {
    return null;
  }

  try {
    return JSON.parse(storedValue) as StoredSession;
  } catch {
    clearSession();
    return null;
  }
}

export function getValidAccessToken(): string | null {
  const session = getSession();

  if (!session) {
    return null;
  }

  const safetyWindowMilliseconds = 30_000;

  if (Date.now() >= session.expiresAt - safetyWindowMilliseconds) {
    return null;
  }

  return session.accessToken;
}

export function getUserGroups(): string[] {
  const session = getSession();

  if (!session) {
    return [];
  }

  const payload = decodeJwtPayload(session.accessToken);
  const groups = payload?.['cognito:groups'];

  return Array.isArray(groups) ? groups : [];
}

export function getUserEmail(): string | null {
  const session = getSession();

  if (!session) {
    return null;
  }

  const payload = decodeJwtPayload(session.idToken);
  return typeof payload?.email === 'string' ? payload.email : null;
}

export function hasAnyRole(...allowedRoles: string[]): boolean {
  const groups = getUserGroups();
  return allowedRoles.some((role) => groups.includes(role));
}

export function isAuthenticated(): boolean {
  return getValidAccessToken() !== null;
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(RETURN_PATH_KEY);
}

export function savePkceVerifier(value: string): void {
  sessionStorage.setItem(PKCE_VERIFIER_KEY, value);
}

export function takePkceVerifier(): string | null {
  const value = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  return value;
}

export function saveOAuthState(value: string): void {
  sessionStorage.setItem(OAUTH_STATE_KEY, value);
}

export function takeOAuthState(): string | null {
  const value = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  return value;
}

export function saveReturnPath(value: string): void {
  sessionStorage.setItem(RETURN_PATH_KEY, value);
}

export function takeReturnPath(): string {
  const value = sessionStorage.getItem(RETURN_PATH_KEY);
  sessionStorage.removeItem(RETURN_PATH_KEY);

  if (!value || !value.startsWith('/dashboard/')) {
    return '/dashboard/index.html';
  }

  return value;
}
