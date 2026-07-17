/**
 * PKCE utilities for Cognito Authorization Code Grant.
 */

const PKCE_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function generateRandomString(length = 64): string {
  if (length < 43 || length > 128) {
    throw new Error('PKCE verifier length must be between 43 and 128.');
  }

  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);

  return Array.from(
    randomValues,
    (value) => PKCE_CHARACTERS[value % PKCE_CHARACTERS.length]
  ).join('');
}

export async function createCodeChallenge(
  codeVerifier: string
): Promise<string> {
  const encodedVerifier = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    encodedVerifier
  );

  return bytesToBase64Url(new Uint8Array(digest));
}
