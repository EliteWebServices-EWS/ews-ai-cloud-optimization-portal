import { createHash } from 'node:crypto';

import { stableStringify } from '../persistence-intelligence/canonical-json';
import { GOVERNANCE_CONVERGENCE_RULE_VERSION } from './governance-convergence-engine';

export const GOVERNANCE_CONVERGENCE_MISSING_EVENT = 'MISSING' as const;

export function buildObservationBackedLogicalResultId(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  logicalObservationId: string;
  ruleVersion?: string;
}): string {
  return createHash('sha256')
    .update(
      stableStringify({
        tenantId: input.tenantId,
        accountId: input.accountId,
        findingKey: input.findingKey,
        logicalObservationId: input.logicalObservationId,
        ruleVersion: input.ruleVersion ?? GOVERNANCE_CONVERGENCE_RULE_VERSION,
      }),
      'utf8',
    )
    .digest('hex');
}

export function buildMissingLogicalResultId(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  analysisRunId: string;
  ruleVersion?: string;
}): string {
  return createHash('sha256')
    .update(
      stableStringify({
        tenantId: input.tenantId,
        accountId: input.accountId,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
        ruleVersion: input.ruleVersion ?? GOVERNANCE_CONVERGENCE_RULE_VERSION,
        event: GOVERNANCE_CONVERGENCE_MISSING_EVENT,
      }),
      'utf8',
    )
    .digest('hex');
}
