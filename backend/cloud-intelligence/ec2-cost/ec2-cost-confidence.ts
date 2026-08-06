import type { Ec2CostConfidenceLevel, Ec2PerformanceEvidence } from './ec2-cost-models';

export function scoreConfidence(input: {
  evidence?: Ec2PerformanceEvidence;
  pricingAvailable: boolean;
  launchTimeAvailable: boolean;
  networkLow?: boolean;
}): { score: number; level: Ec2CostConfidenceLevel } {
  let score = 0.35;
  const evidence = input.evidence;
  if (!evidence || evidence.dataCompleteness === 'NO_DATA') {
    return { score: 0.25, level: 'LOW' };
  }
  if (evidence.dataCompleteness === 'COMPLETE') {
    score += 0.25;
  } else if (evidence.dataCompleteness === 'PARTIAL') {
    score += 0.15;
  } else {
    score += 0.05;
  }
  if (input.pricingAvailable) {
    score += 0.1;
  }
  if (input.launchTimeAvailable) {
    score += 0.05;
  }
  if (input.networkLow) {
    score += 0.05;
  }
  score = Math.min(0.95, Math.max(0.1, score));
  const level: Ec2CostConfidenceLevel =
    score >= 0.75 ? 'HIGH' : score >= 0.5 ? 'MEDIUM' : 'LOW';
  return { score: Math.round(score * 100) / 100, level };
}
