import { stableStringify } from '../persistence-intelligence/canonical-json';

/**
 * Fields that materially define a control's evidence state for convergence
 * comparison. Reuses the generic canonical-JSON fingerprinting utility from
 * persistence-intelligence (Engineer 1's Sprint 1 work) — that utility has
 * no coupling to cost-recommendation types, so importing it directly is safe
 * reuse rather than a parallel implementation.
 *
 * Deliberately excluded (mirrors Sprint 1's own exclusion list and for the
 * same reason — irrelevant to material equivalence): free-text message,
 * remediation copy, and severity. Severity is a static function of
 * (check, ruleVersion) in the analyzer, not an independent signal; a
 * severity change without a ruleVersion bump would be an analyzer
 * inconsistency to fix upstream, not a convergence-worthy event.
 */
export interface GovernanceEvidenceFingerprintInput {
  check: string;
  /** undefined = not evaluated; never coerce to a boolean before fingerprinting. */
  satisfied: boolean | undefined;
  ruleVersion: string;
}

export function computeGovernanceEvidenceFingerprint(
  input: GovernanceEvidenceFingerprintInput,
): string {
  return stableStringify({
    version: 1,
    check: input.check.trim(),
    satisfied: input.satisfied ?? null,
    ruleVersion: input.ruleVersion.trim(),
  });
}
