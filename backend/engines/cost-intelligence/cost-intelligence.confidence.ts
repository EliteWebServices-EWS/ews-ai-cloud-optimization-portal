/**
 * Confidence scoring for EC2 Cost Intelligence findings.
 *
 * DELIBERATE DESIGN DECISION: this does NOT call engines/confidence
 * (calculateConfidence). That engine's criteria (workload-stability,
 * historical-consistency, telemetry-continuity) are built entirely around
 * CloudWatch CPU/memory utilization history, which this engine does not
 * collect (see Volume/handbook risk: "no CloudWatch client installed").
 * Forcing cost-intelligence findings through those criteria would produce a
 * ConfidenceResult that looks authoritative but is scored on data that was
 * never gathered — every finding would silently bottom out near zero for
 * reasons unrelated to whether the *cost* finding itself is trustworthy.
 *
 * Instead this produces the same ConfidenceResult shape (so it composes with
 * CostFinding, reports, and the frontend exactly like every other engine's
 * output), scored on criteria that actually apply to a cost finding: was the
 * spend figure observed (Cost Explorer) or estimated (reference pricing),
 * and was a concrete replacement instance type resolved.
 */

import { CONFIDENCE_STATUS } from '../../shared/constants';
import type { ConfidenceFactor, ConfidenceResult } from '../../shared/types';
import type { CostRuleMatch } from './cost-intelligence.rules';

export interface CostConfidenceInput {
  match: CostRuleMatch;
  /** True when the instance's cost came from Cost Explorer rather than a pricing estimate. */
  costDataObserved: boolean;
  /** True when the projected/replacement instance type resolved to a known reference price. */
  pricingResolved: boolean;
}

function scoreStatus(score: number): ConfidenceResult['status'] {
  if (score >= 80) return CONFIDENCE_STATUS.HIGH;
  if (score >= 50) return CONFIDENCE_STATUS.MEDIUM;
  return CONFIDENCE_STATUS.LOW;
}

function legacyLevel(status: ConfidenceResult['status']): ConfidenceResult['level'] {
  return status === 'HIGH' ? 'high' : status === 'MEDIUM' ? 'medium' : 'low';
}

export function calculateCostConfidence(input: CostConfidenceInput): ConfidenceResult {
  const factors: ConfidenceFactor[] = [
    {
      name: 'spend-data-source',
      score: input.costDataObserved ? 100 : 55,
      weight: 60,
      detail: input.costDataObserved
        ? 'Monthly spend was observed directly from Cost Explorer.'
        : 'Monthly spend was estimated from static on-demand reference pricing (Cost Explorer data unavailable).',
    },
    {
      name: 'pricing-resolution',
      score: input.pricingResolved ? 100 : 30,
      weight: 40,
      detail: input.pricingResolved
        ? 'A reference price was resolved for the current and/or projected instance type.'
        : 'No reference price was available for one of the involved instance types.',
    },
  ];

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = Math.round(
    factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight,
  );
  const status = scoreStatus(score);

  return {
    score,
    status,
    reason: `Cost finding "${input.match.findingType}" confidence is ${status.toLowerCase()} based on spend-data source and pricing resolution.`,
    factors,
    level: legacyLevel(status),
  };
}
