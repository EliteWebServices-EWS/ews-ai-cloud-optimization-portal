import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessGovernanceConvergence,
  buildMissingEvidenceAssessment,
  GOVERNANCE_CONVERGENCE_RULE_VERSION,
} from '../../governance-convergence/governance-convergence-engine';
import { computeGovernanceEvidenceFingerprint } from '../../governance-convergence/governance-evidence-fingerprint';
import {
  deriveGovernanceEvidenceFromFindings,
  GOVERNANCE_TRACKED_CHECKS,
} from '../../governance-convergence/governance-evidence-reuse';
import { GOVERNANCE_CONVERGENCE_REASON } from '../../governance-convergence/reason-codes';
import { GovernanceConvergenceDataQualityError } from '../../governance-convergence/errors';
import type {
  GovernanceEvidenceObservationRecord,
  GovernanceEvidenceSnapshot,
} from '../../governance-convergence/types';

const RULE_VERSION = '1';

function evidence(overrides: Partial<GovernanceEvidenceSnapshot> = {}): GovernanceEvidenceSnapshot {
  const base: GovernanceEvidenceSnapshot = {
    satisfied: true,
    check: 'unrestricted_ssh',
    category: 'security',
    fingerprint: '',
    ruleVersion: RULE_VERSION,
    ...overrides,
  };
  base.fingerprint = computeGovernanceEvidenceFingerprint({
    check: base.check,
    satisfied: base.satisfied,
    ruleVersion: base.ruleVersion,
  });
  return base;
}

function priorObservation(
  overrides: Partial<GovernanceEvidenceObservationRecord> = {},
): GovernanceEvidenceObservationRecord {
  return {
    observationId: 'obs-prior',
    logicalObservationId: 'log-prior',
    tenantId: 'tenant-a',
    accountId: 'acct-1',
    region: 'us-east-1',
    resourceType: 'INSTANCE',
    resourceId: 'i-abc123',
    check: 'unrestricted_ssh',
    findingKey: 'tenant-a#acct-1#us-east-1#i-abc123#unrestricted_ssh',
    analysisRunId: 'run-1',
    observationTimestamp: '2026-08-01T00:00:00.000Z',
    collectionTimestamp: '2026-08-01T00:00:00.000Z',
    persistedAt: '2026-08-01T00:00:01.000Z',
    evidence: evidence(),
    version: 1,
    ...overrides,
  };
}

describe('assessGovernanceConvergence — decision table (Task 2)', () => {
  it('returns null when no comparable prior observation exists (first sighting)', () => {
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: true }),
      currentObservationId: 'obs-current',
      previousObservation: null,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result, null);
  });

  it('classifies an unchanged compliant control as PRESERVED', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: true }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: true }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'PRESERVED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.CONTROL_STILL_SATISFIED]);
    assert.equal(result?.previousEvidenceId, 'obs-prior');
    assert.equal(result?.currentEvidenceId, 'obs-current');
    assert.equal(result?.ruleVersion, GOVERNANCE_CONVERGENCE_RULE_VERSION);
  });

  it('classifies an unchanged persisting violation as PRESERVED with a distinct reason', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: false }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: false }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'PRESERVED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.VIOLATION_PERSISTS_UNCHANGED]);
  });

  it('classifies a corrected violation as IMPROVED', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: false }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: true }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'IMPROVED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.VIOLATION_RESOLVED]);
  });

  it('classifies insufficient-evidence resolving to compliant as IMPROVED', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: undefined }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: true }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'IMPROVED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.MECHANISM_STRENGTHENED]);
  });

  it('classifies a mechanism change with unchanged compliance as REPLACED', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: true, ruleVersion: '1' }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: true, ruleVersion: '2' }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'REPLACED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.MECHANISM_CHANGED_STILL_SATISFIED]);
  });

  it('classifies a regression from satisfied to violating as REPLACED with CONTROL_REGRESSED', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: true }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: false }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'REPLACED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.CONTROL_REGRESSED]);
  });

  it('classifies evidence quality degrading to insufficient as REPLACED, not MISSING', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: true }) });
    const result = assessGovernanceConvergence({
      currentEvidence: evidence({ satisfied: undefined }),
      currentObservationId: 'obs-current',
      previousObservation: prior,
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(result?.state, 'REPLACED');
    assert.deepEqual(result?.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.VIOLATION_CONTENT_CHANGED]);
  });

  it('throws a data-quality error when comparing evidence for two different checks', () => {
    const prior = priorObservation({ evidence: evidence({ check: 'ebs_encryption' }) });
    assert.throws(
      () =>
        assessGovernanceConvergence({
          currentEvidence: evidence({ check: 'unrestricted_ssh' }),
          currentObservationId: 'obs-current',
          previousObservation: prior,
          evaluatedAt: '2026-08-02T00:00:00.000Z',
        }),
      (error: unknown) => error instanceof GovernanceConvergenceDataQualityError,
    );
  });
});

describe('buildMissingEvidenceAssessment (Task 2 — required evidence disappears)', () => {
  it('produces MISSING with no currentEvidenceId, never inferring compliance', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: true }) });
    const result = buildMissingEvidenceAssessment({
      previousObservation: prior,
      evaluatedAt: '2026-08-03T00:00:00.000Z',
    });
    assert.equal(result.state, 'MISSING');
    assert.equal(result.currentEvidenceId, undefined);
    assert.equal(result.previousEvidenceId, 'obs-prior');
    assert.deepEqual(result.reasonCodes, [GOVERNANCE_CONVERGENCE_REASON.CURRENT_EVIDENCE_ABSENT]);
  });

  it('produces MISSING regardless of whether the prior control was violating', () => {
    const prior = priorObservation({ evidence: evidence({ satisfied: false }) });
    const result = buildMissingEvidenceAssessment({
      previousObservation: prior,
      evaluatedAt: '2026-08-03T00:00:00.000Z',
    });
    assert.equal(result.state, 'MISSING');
  });
});

describe('computeGovernanceEvidenceFingerprint determinism', () => {
  it('produces identical fingerprints for identical inputs regardless of key order', () => {
    const a = computeGovernanceEvidenceFingerprint({
      check: 'unrestricted_ssh',
      satisfied: true,
      ruleVersion: '1',
    });
    const b = computeGovernanceEvidenceFingerprint({
      ruleVersion: '1',
      satisfied: true,
      check: 'unrestricted_ssh',
    });
    assert.equal(a, b);
  });

  it('distinguishes satisfied=false from satisfied=undefined', () => {
    const violating = computeGovernanceEvidenceFingerprint({
      check: 'unrestricted_ssh',
      satisfied: false,
      ruleVersion: '1',
    });
    const unknown = computeGovernanceEvidenceFingerprint({
      check: 'unrestricted_ssh',
      satisfied: undefined,
      ruleVersion: '1',
    });
    assert.notEqual(violating, unknown);
  });

  it('changes when ruleVersion changes even if satisfied is unchanged', () => {
    const v1 = computeGovernanceEvidenceFingerprint({ check: 'ebs_encryption', satisfied: true, ruleVersion: '1' });
    const v2 = computeGovernanceEvidenceFingerprint({ check: 'ebs_encryption', satisfied: true, ruleVersion: '2' });
    assert.notEqual(v1, v2);
  });
});

describe('deriveGovernanceEvidenceFromFindings (Task 3 — reuse existing findings)', () => {
  it('derives satisfied=false when the existing analyzer reports a direct violation', () => {
    const snapshot = deriveGovernanceEvidenceFromFindings(
      [{ check: 'unrestricted_ssh', severity: 'critical' }],
      GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
      RULE_VERSION,
    );
    assert.equal(snapshot.satisfied, false);
    assert.equal(snapshot.severity, 'critical');
    assert.equal(snapshot.category, 'security');
  });

  it('derives satisfied=true when no violation and no evidence-insufficiency gate is active', () => {
    const snapshot = deriveGovernanceEvidenceFromFindings([], GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE, RULE_VERSION);
    assert.equal(snapshot.satisfied, true);
  });

  it('does not equate insufficient security-group evidence with SSH compliance (Task 2)', () => {
    const snapshot = deriveGovernanceEvidenceFromFindings(
      [{ check: 'insufficient_security_group_evidence', severity: 'medium' }],
      GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
      RULE_VERSION,
    );
    assert.equal(snapshot.satisfied, undefined);
  });

  it('does not equate insufficient EBS evidence with encryption compliance (Task 2)', () => {
    const snapshot = deriveGovernanceEvidenceFromFindings(
      [{ check: 'insufficient_ebs_encryption_evidence', severity: 'medium' }],
      GOVERNANCE_TRACKED_CHECKS.EBS_ENCRYPTION,
      RULE_VERSION,
    );
    assert.equal(snapshot.satisfied, undefined);
  });

  it('leaves unrelated tracked checks unaffected by an insufficiency gate on another check', () => {
    const snapshot = deriveGovernanceEvidenceFromFindings(
      [{ check: 'insufficient_security_group_evidence', severity: 'medium' }],
      GOVERNANCE_TRACKED_CHECKS.EBS_ENCRYPTION,
      RULE_VERSION,
    );
    assert.equal(snapshot.satisfied, true);
  });

  it('classifies required_tags and backup_policy as governance category', () => {
    assert.equal(
      deriveGovernanceEvidenceFromFindings([], GOVERNANCE_TRACKED_CHECKS.REQUIRED_TAGS, RULE_VERSION).category,
      'governance',
    );
    assert.equal(
      deriveGovernanceEvidenceFromFindings([], GOVERNANCE_TRACKED_CHECKS.BACKUP_POLICY, RULE_VERSION).category,
      'governance',
    );
  });

  it('classifies unrestricted_ssh and ebs_encryption as security category', () => {
    assert.equal(
      deriveGovernanceEvidenceFromFindings([], GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE, RULE_VERSION).category,
      'security',
    );
    assert.equal(
      deriveGovernanceEvidenceFromFindings([], GOVERNANCE_TRACKED_CHECKS.EBS_ENCRYPTION, RULE_VERSION).category,
      'security',
    );
  });
});
