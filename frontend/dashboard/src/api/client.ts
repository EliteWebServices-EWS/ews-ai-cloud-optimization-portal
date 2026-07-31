/**
 * Base API client — handles authentication, fetch, response parsing,
 * and error normalization.
 */

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from '../types';
import { getOrRefreshAccessToken } from '../auth/guard';
import { beginLogin } from '../auth/login';
import { clearSession } from '../auth/session';

export const PRIVILEGED_MFA_REAUTH_USER_MESSAGE =
  'Your secure administrator session has expired. Sign in again to continue.';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly stage?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function isMfaEvidenceUnavailableError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.code === 'MFA_EVIDENCE_UNAVAILABLE';
}

/** Clears session and starts Cognito logout (user-initiated; not used on automatic API retry). */
export { logout as beginSecureReauthentication } from '../auth/logout';

const DEFAULT_BASE =
  import.meta.env.VITE_API_BASE ?? '/api/v1';

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = await getOrRefreshAccessToken();

  if (!accessToken) {
    clearSession();
    await beginLogin();
    throw new ApiClientError(
      'AUTHENTICATION_REQUIRED',
      'Redirecting to secure sign-in.'
    );
  }

  const url = `${DEFAULT_BASE}${path}`;
  const headers = new Headers(options.headers);

  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearSession();
    await beginLogin();

    throw new ApiClientError(
      'SESSION_EXPIRED',
      'Your session expired. Redirecting to secure sign-in.'
    );
  }

  let body: ApiSuccessResponse<T> | ApiErrorResponse;

  try {
    body = (await response.json()) as
      | ApiSuccessResponse<T>
      | ApiErrorResponse;
  } catch {
    throw new ApiClientError(
      'INVALID_API_RESPONSE',
      `The API returned an unexpected response with status ${response.status}.`
    );
  }

  if (!response.ok || !body.success) {
    if ('error' in body) {
      const message =
        body.error.code === 'MFA_EVIDENCE_UNAVAILABLE'
          ? PRIVILEGED_MFA_REAUTH_USER_MESSAGE
          : body.error.message;

      throw new ApiClientError(
        body.error.code,
        message,
        body.error.stage
      );
    }

    throw new ApiClientError(
      'API_REQUEST_FAILED',
      `The API request failed with status ${response.status}.`
    );
  }

  return body.data;
}
