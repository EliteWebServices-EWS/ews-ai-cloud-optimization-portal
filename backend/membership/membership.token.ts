/**
 * Invitation bearer tokens.
 *
 * The raw token is returned to the caller exactly once (at creation time)
 * and is never persisted. Only a SHA-256 hash of the token is stored, so a
 * database read (or leak) cannot be used to forge acceptance requests.
 */

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTE_LENGTH = 32;

/** Generates a cryptographically random, URL-safe invitation token. */
export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

/** Derives the stored lookup hash for a raw invitation token. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Generates a unique invitation identifier. */
export function generateInvitationId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `inv-${timestamp}-${randomSuffix}`;
}

/** Generates a unique, opaque membership identifier. */
export function generateMemberId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `mem-${timestamp}-${randomSuffix}`;
}
