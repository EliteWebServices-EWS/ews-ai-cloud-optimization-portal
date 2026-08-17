import { computeGovernanceEvidenceFingerprint } from './governance-evidence-fingerprint';
import type { GovernanceEvidenceSnapshot } from './types';

/**
 * Minimal shape this module needs from an EC2 security/governance finding —
 * matches (but does not import, to avoid a hard dependency edge from this
 * standalone module onto cloud-intelligence) the fields on
 * Ec2SecurityFinding produced by engines/ec2-security/ec2-security.analyzer.ts.
 */
export interface ReusableSecurityFinding {
  check: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Task 2's named EC2 governance signals, mapped to the exact `check`
 * identifiers already produced by the existing analyzer
 * (engines/ec2-security/ec2-security.analyzer.ts). This engine tracks
 * convergence only for this fixed, known-evaluated-every-run set — the
 * analyzer runs every check unconditionally for every instance, so absence
 * of a corresponding finding reliably means "evaluated and passed" for
 * these checks specifically (see INSUFFICIENT_EVIDENCE_GATES below for the
 * exception).
 */
export const GOVERNANCE_TRACKED_CHECKS = {
  REQUIRED_TAGS: 'required_tags',
  NAME_TAG_POLICY: 'naming_standard',
  EBS_ENCRYPTION: 'ebs_encryption',
  PUBLIC_IP_EXPOSURE: 'public_ip_exposure',
  SSH_EXPOSURE: 'unrestricted_ssh',
  IAM_INSTANCE_PROFILE: 'iam_instance_profile',
  BACKUP_POLICY: 'backup_policy',
  MONITORING_CONFIGURATION: 'cloudwatch_monitoring',
} as const;

export type GovernanceTrackedCheck =
  (typeof GOVERNANCE_TRACKED_CHECKS)[keyof typeof GOVERNANCE_TRACKED_CHECKS];

export const GOVERNANCE_TRACKED_CHECK_LIST: readonly GovernanceTrackedCheck[] =
  Object.values(GOVERNANCE_TRACKED_CHECKS);

/**
 * When one of these evidence-insufficiency marker checks is present in the
 * analyzer's output (added by ec2-security-evidence.ts's
 * supplementAnalysisForInsufficientEvidence), the listed tracked checks
 * cannot be verified this run and must be recorded as `satisfied: undefined`
 * — never inferred as compliant just because no direct violation finding is
 * present. This is the concrete mechanism for "do not equate absence of
 * evidence with compliance" (Task 2).
 */
const INSUFFICIENT_EVIDENCE_GATES: Record<string, GovernanceTrackedCheck[]> = {
  insufficient_security_group_evidence: [GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE],
  insufficient_ebs_encryption_evidence: [GOVERNANCE_TRACKED_CHECKS.EBS_ENCRYPTION],
};

function findByCheck(
  findings: ReusableSecurityFinding[],
  check: string,
): ReusableSecurityFinding | undefined {
  return findings.find((finding) => finding.check === check);
}

/**
 * Derives a GovernanceEvidenceSnapshot for one tracked check from the
 * existing analyzer's per-instance result (Task 3 — reuses the existing
 * scanner's output; performs no independent scanning).
 *
 * `findings` should be the combined securityFindings + governanceFindings
 * array for one instance from a single analysis run — the same evidence the
 * EC2 security orchestrator already computes and persists.
 */
export function deriveGovernanceEvidenceFromFindings(
  findings: ReusableSecurityFinding[],
  check: GovernanceTrackedCheck,
  ruleVersion: string,
): GovernanceEvidenceSnapshot {
  const direct = findByCheck(findings, check);

  let satisfied: boolean | undefined;
  if (direct) {
    satisfied = false;
  } else {
    const gatedBy = Object.entries(INSUFFICIENT_EVIDENCE_GATES).find(([, gatedChecks]) =>
      gatedChecks.includes(check),
    );
    const gateActive = gatedBy && findByCheck(findings, gatedBy[0]);
    satisfied = gateActive ? undefined : true;
  }

  const category: GovernanceEvidenceSnapshot['category'] =
    check === GOVERNANCE_TRACKED_CHECKS.REQUIRED_TAGS ||
    check === GOVERNANCE_TRACKED_CHECKS.NAME_TAG_POLICY ||
    check === GOVERNANCE_TRACKED_CHECKS.BACKUP_POLICY
      ? 'governance'
      : 'security';

  return {
    satisfied,
    check,
    category,
    severity: direct?.severity,
    fingerprint: computeGovernanceEvidenceFingerprint({ check, satisfied, ruleVersion }),
    ruleVersion,
  };
}
