import type {
  Candidate,
  ConfidenceResult,
  FinancialImpact,
  GovernanceResult,
  Recommendation,
  RecommendationDecision,
  RecommendationExplanation,
  RecommendationReason,
  RecommendationSummary,
  StandardizedEvidence,
} from '../../shared/types';
import {
  CONFIDENCE_STATUS,
  FINANCIAL_STATUS,
  GOVERNANCE_STATUS,
  READINESS_STATUS,
  RECOMMENDATION_STATUS,
} from '../../shared/constants';
import type { RecommendationConfig } from './recommendation.config';

export interface RecommendationInput {
  candidate: Candidate;
  evidence: StandardizedEvidence;
  governance: GovernanceResult;
  financialImpact: FinancialImpact;
  confidence: ConfidenceResult;
  config: RecommendationConfig;
}

function buildAction(
  candidate: Candidate,
  evidence: StandardizedEvidence
): Recommendation | undefined {
  const hint = evidence.recommendations.find((rec) => rec.resourceId === candidate.resourceId);
  if (!hint) {
    return undefined;
  }

  return {
    action: hint.action,
    resourceId: candidate.resourceId,
    resourceType: candidate.resourceType,
    from: evidence.instance.instanceType,
    to: hint.target,
    reason: hint.reason,
    region: candidate.region,
    metadata: {
      source: hint.source,
      finding: hint.finding,
    },
  };
}

function buildSummary(action: Recommendation | undefined): RecommendationSummary {
  if (!action?.from || !action.to) {
    return {
      action: action?.action ?? 'none',
      fromInstanceType: action?.from ?? 'unknown',
      toInstanceType: action?.to ?? 'unknown',
      description: 'No optimization action available',
    };
  }

  return {
    action: action.action,
    fromInstanceType: action.from,
    toInstanceType: action.to,
    description: `${capitalize(action.action)} from ${action.from} to ${action.to}`,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildExplanation(input: RecommendationInput): RecommendationExplanation {
  return {
    governance: input.governance.reason,
    financial:
      input.financialImpact.status === FINANCIAL_STATUS.ESTIMATED
        ? `Estimated savings of ${input.financialImpact.monthlySavings} ${input.financialImpact.currency}/month (${input.financialImpact.percentageReduction}% reduction)`
        : `Financial status: ${input.financialImpact.status}`,
    confidence: input.confidence.reason,
  };
}

/**
 * Derive a recommendation decision from upstream engine outputs.
 * Never calls providers — uses evidence hints only.
 */
export function deriveRecommendationDecision(
  input: RecommendationInput
): RecommendationDecision {
  const action = buildAction(input.candidate, input.evidence);
  const detail = buildSummary(action);
  const explanation = buildExplanation(input);
  const reasons: RecommendationReason[] = [];

  if (input.governance.decision === GOVERNANCE_STATUS.REJECTED) {
    reasons.push({ code: 'GOVERNANCE_REJECTED', message: input.governance.reason });
    return {
      status: RECOMMENDATION_STATUS.NOT_RECOMMENDED,
      summary: detail.description,
      reason: 'Governance rejected — optimization not permitted',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (input.governance.status === READINESS_STATUS.NOT_READY) {
    reasons.push({ code: 'NOT_READY', message: 'Evidence readiness is insufficient' });
    return {
      status: RECOMMENDATION_STATUS.NOT_RECOMMENDED,
      summary: detail.description,
      reason: 'Evidence not ready for recommendation',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (input.financialImpact.status !== FINANCIAL_STATUS.ESTIMATED) {
    reasons.push({
      code: 'FINANCIAL_INSUFFICIENT',
      message: `Financial status is ${input.financialImpact.status}`,
    });
    return {
      status: RECOMMENDATION_STATUS.INSUFFICIENT_DATA,
      summary: detail.description,
      reason: 'Financial impact could not be estimated',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (!action) {
    reasons.push({ code: 'NO_ACTION', message: 'No optimization action available from evidence' });
    return {
      status: RECOMMENDATION_STATUS.INSUFFICIENT_DATA,
      summary: detail.description,
      reason: 'No optimization target available in evidence',
      detail,
      explanation,
      reasons,
    };
  }

  if (input.financialImpact.monthlySavings < input.config.minMonthlySavings) {
    reasons.push({
      code: 'SAVINGS_BELOW_THRESHOLD',
      message: `Monthly savings ${input.financialImpact.monthlySavings} below minimum ${input.config.minMonthlySavings}`,
    });
    return {
      status: RECOMMENDATION_STATUS.NOT_RECOMMENDED,
      summary: detail.description,
      reason: 'Estimated savings do not meet minimum threshold',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (input.confidence.status === CONFIDENCE_STATUS.LOW) {
    reasons.push({ code: 'LOW_CONFIDENCE', message: input.confidence.reason });
    return {
      status: RECOMMENDATION_STATUS.NOT_RECOMMENDED,
      summary: detail.description,
      reason: 'Confidence too low to recommend optimization',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (input.governance.decision === GOVERNANCE_STATUS.NEEDS_APPROVAL) {
    reasons.push({ code: 'NEEDS_APPROVAL', message: input.governance.reason });
    return {
      status: RECOMMENDATION_STATUS.DEFERRED,
      summary: detail.description,
      reason: `Deferred — ${input.governance.reason}`,
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (
    input.confidence.status === CONFIDENCE_STATUS.MEDIUM &&
    input.financialImpact.percentageReduction < input.config.minPercentageReduction
  ) {
    reasons.push({
      code: 'MODERATE_CONFIDENCE_LOW_SAVINGS',
      message: 'Medium confidence with limited savings percentage',
    });
    return {
      status: RECOMMENDATION_STATUS.DEFERRED,
      summary: detail.description,
      reason: 'Deferred — moderate confidence with limited savings impact',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  if (input.governance.readinessScore < input.config.minReadinessScore) {
    reasons.push({
      code: 'READINESS_BELOW_THRESHOLD',
      message: `Readiness score ${input.governance.readinessScore} below minimum`,
    });
    return {
      status: RECOMMENDATION_STATUS.DEFERRED,
      summary: detail.description,
      reason: 'Deferred — readiness score below recommendation threshold',
      detail,
      explanation,
      reasons,
      action,
    };
  }

  return {
    status: RECOMMENDATION_STATUS.RECOMMENDED,
    summary: detail.description,
    reason: 'Governance passed, financial benefit significant, confidence sufficient',
    detail,
    explanation,
    reasons: [
      { code: 'GOVERNANCE_PASSED', message: input.governance.reason },
      {
        code: 'FINANCIAL_BENEFIT',
        message: `${input.financialImpact.monthlySavings} ${input.financialImpact.currency}/month savings`,
      },
      { code: 'CONFIDENCE_SUFFICIENT', message: input.confidence.reason },
    ],
    action,
  };
}
