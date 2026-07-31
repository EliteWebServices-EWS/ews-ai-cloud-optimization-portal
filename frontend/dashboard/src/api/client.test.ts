import { describe, it, expect } from 'vitest';
import {
  ApiClientError,
  PRIVILEGED_MFA_REAUTH_USER_MESSAGE,
  isMfaEvidenceUnavailableError,
} from './client';

describe('api client privileged MFA errors', () => {
  it('recognizes MFA_EVIDENCE_UNAVAILABLE', () => {
    const error = new ApiClientError(
      'MFA_EVIDENCE_UNAVAILABLE',
      PRIVILEGED_MFA_REAUTH_USER_MESSAGE
    );

    expect(isMfaEvidenceUnavailableError(error)).toBe(true);
  });

  it('does not treat other errors as MFA evidence unavailable', () => {
    expect(
      isMfaEvidenceUnavailableError(
        new ApiClientError('FORBIDDEN', 'Denied')
      )
    ).toBe(false);
  });
});
