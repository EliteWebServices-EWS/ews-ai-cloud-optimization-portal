import type {
  Ec2SecurityFindingRecord,
  Ec2SecuritySummaryRecord,
} from './ec2-security-models';
import type { Ec2SecurityAnalysisResult } from '../../engines/ec2-security';
import { computeComplianceScore } from './ec2-security-inventory-mapper';

export type Ec2SecurityScoreAvailability = 'complete' | 'partial' | 'unavailable';

export interface Ec2SecuritySummaryView {
  scope: 'account' | 'region';
  region?: string;
  regionsIncluded: string[];
  scoreAvailability: Ec2SecurityScoreAvailability;
  securityScore: number | null;
  governanceScore: number | null;
  complianceScore: number | null;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'unavailable';
  instancesAnalyzed: number;
  openFindingCount: number;
  findingsBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  analyzedAt: string | null;
  analysisRunId?: string;
  warnings: string[];
}

const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 } as const;

export function summarizeRegionalAnalysisResults(results: Ec2SecurityAnalysisResult[]): {
  instancesAnalyzed: number;
  securityScore: number;
  governanceScore: number;
  complianceScore: number;
  riskLevel: Ec2SecuritySummaryRecord['riskLevel'];
} {
  if (results.length === 0) {
    return {
      instancesAnalyzed: 0,
      securityScore: 0,
      governanceScore: 0,
      complianceScore: 0,
      riskLevel: 'low',
    };
  }
  const securityScore = Math.round(
    results.reduce((sum, result) => sum + result.securityScore, 0) / results.length,
  );
  const governanceScore = Math.round(
    results.reduce((sum, result) => sum + result.governanceScore, 0) / results.length,
  );
  const complianceScore = computeComplianceScore(securityScore, governanceScore);
  const riskLevel = results.reduce<Ec2SecuritySummaryRecord['riskLevel']>(
    (worst, result) =>
      severityWeight[result.riskLevel] > severityWeight[worst] ? result.riskLevel : worst,
    'low',
  );
  return {
    instancesAnalyzed: results.length,
    securityScore,
    governanceScore,
    complianceScore,
    riskLevel,
  };
}

function averageScore(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function worstRiskLevel(
  levels: Array<Ec2SecuritySummaryRecord['riskLevel']>,
): Ec2SecuritySummaryView['riskLevel'] {
  if (levels.length === 0) {
    return 'unavailable';
  }
  return levels.reduce<'critical' | 'high' | 'medium' | 'low'>(
    (worst, level) =>
      severityWeight[level] > severityWeight[worst] ? level : worst,
    'low',
  );
}

function countFindingsBySeverity(findings: Ec2SecurityFindingRecord[]): Ec2SecuritySummaryView['findingsBySeverity'] {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    if (finding.status !== 'OPEN') {
      continue;
    }
    counts[finding.severity] += 1;
  }
  return counts;
}

export function buildRegionSecuritySummaryView(
  summary: Ec2SecuritySummaryRecord,
  openFindings: Ec2SecurityFindingRecord[],
): Ec2SecuritySummaryView {
  const regionFindings = openFindings.filter((finding) => finding.region === summary.region);
  const scoreAvailable = summary.instancesAnalyzed > 0;
  return {
    scope: 'region',
    region: summary.region,
    regionsIncluded: [summary.region],
    scoreAvailability: scoreAvailable ? 'complete' : 'unavailable',
    securityScore: scoreAvailable ? summary.securityScore : null,
    governanceScore: scoreAvailable ? summary.governanceScore : null,
    complianceScore: scoreAvailable ? summary.complianceScore : null,
    riskLevel: scoreAvailable ? summary.riskLevel : 'unavailable',
    instancesAnalyzed: summary.instancesAnalyzed,
    openFindingCount: regionFindings.length,
    findingsBySeverity: countFindingsBySeverity(regionFindings),
    analyzedAt: summary.analyzedAt,
    analysisRunId: summary.analysisRunId,
    warnings: [],
  };
}

export function buildAccountSecuritySummaryView(
  summaries: Ec2SecuritySummaryRecord[],
  openFindings: Ec2SecurityFindingRecord[],
): Ec2SecuritySummaryView | null {
  if (summaries.length === 0) {
    return null;
  }
  const regionsIncluded = [...new Set(summaries.map((summary) => summary.region))].sort();
  const scored = summaries.filter((summary) => summary.instancesAnalyzed > 0);
  const securityScore = averageScore(scored.map((summary) => summary.securityScore));
  const governanceScore = averageScore(scored.map((summary) => summary.governanceScore));
  const complianceScore = averageScore(scored.map((summary) => summary.complianceScore));

  let scoreAvailability: Ec2SecurityScoreAvailability = 'unavailable';
  if (scored.length === summaries.length && scored.length > 0) {
    scoreAvailability = 'complete';
  } else if (scored.length > 0) {
    scoreAvailability = 'partial';
  }

  const analyzedAt = summaries
    .map((summary) => summary.analyzedAt)
    .sort()
    .at(-1) ?? null;

  const latestRun = summaries
    .slice()
    .sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt))[0];

  return {
    scope: 'account',
    regionsIncluded,
    scoreAvailability,
    securityScore,
    governanceScore,
    complianceScore,
    riskLevel:
      scoreAvailability === 'unavailable'
        ? 'unavailable'
        : worstRiskLevel(scored.map((summary) => summary.riskLevel)),
    instancesAnalyzed: summaries.reduce((sum, summary) => sum + summary.instancesAnalyzed, 0),
    openFindingCount: openFindings.length,
    findingsBySeverity: countFindingsBySeverity(openFindings),
    analyzedAt,
    analysisRunId: latestRun?.analysisRunId,
    warnings:
      scoreAvailability === 'partial'
        ? [
            'Security scores aggregate only regions with analyzed instances; rerun analysis for missing regions.',
          ]
        : [],
  };
}
