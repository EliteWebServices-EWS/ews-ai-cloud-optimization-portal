import {
  GOVERNANCE_STATUS,
  POLICY_SEVERITY,
  POLICY_STATUS,
  READINESS_STATUS,
} from '../../../shared/constants';
import type { GovernanceResult } from '../../../shared/types';

/** Workflow governance contract representing a blocked / failed governance evaluation. */
export function buildGovernanceFailureResult(): GovernanceResult {
  return {
    status: READINESS_STATUS.NOT_READY,
    decision: GOVERNANCE_STATUS.REJECTED,
    readinessScore: 20,
    readiness: {
      score: 20,
      status: READINESS_STATUS.NOT_READY,
      factors: [
        {
          name: 'required-tags',
          score: 0,
          weight: 20,
          met: false,
          detail: 'Required Environment tag missing',
        },
      ],
    },
    reason: 'Governance policies failed — optimization blocked',
    policies: [
      {
        name: 'required-tags',
        status: POLICY_STATUS.FAIL,
        reason: 'Required Environment tag missing',
        severity: POLICY_SEVERITY.HIGH,
      },
    ],
  };
}
