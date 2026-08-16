import type { Ec2DashboardDataProvider, Ec2DashboardLoadInput } from '../ec2/ec2-dashboard-provider';
import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';
import type { Ec2SecurityFinding } from '../types';
import {
  hasVerifiedRatePricingContext,
  isRightsizingCategory,
  maskAccountId,
  pricingStatusLabel,
} from '../ec2/ec2-dashboard-view-model';
import type { Ec2CostRecommendationApi } from './ec2-dashboard-api';
import type { Ec2RightsizingOpportunity } from '../types';
import {
  Ec2DashboardApiError,
  fetchEc2CostRecommendations,
  fetchEc2ResourceSummary,
  fetchEc2SecurityFindings,
  fetchEc2SecuritySummary,
  listTenantAwsAccounts,
} from './ec2-dashboard-api';

export type LiveEc2DashboardErrorCode =
  | 'AUTH_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_REQUIRED'
  | 'ACCOUNT_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVENTORY_ERROR'
  | 'COST_ERROR'
  | 'UNKNOWN';

export interface LiveEc2LoadResult {
  viewModel: Ec2DashboardViewModel;
}

function mapRightsizingOpportunity(item: Ec2CostRecommendationApi): Ec2RightsizingOpportunity {
  const opportunity: Ec2RightsizingOpportunity = {
    instanceId: item.resourceId,
    currentType: item.currentInstanceType ?? 'Instance type unavailable',
    recommendedType: item.candidateInstanceType ?? item.recommendedAction,
  };

  if (Number.isFinite(item.estimatedMonthlySavings)) {
    opportunity.savings = item.estimatedMonthlySavings;
  }

  return opportunity;
}

function mapAverageCpuUtilization(
  performanceSummary: { availability: string; averageCpuUtilizationPercent?: number } | undefined,
): number | undefined {
  if (!performanceSummary) {
    return undefined;
  }
  if (
    performanceSummary.availability !== 'AVAILABLE' &&
    performanceSummary.availability !== 'PARTIAL'
  ) {
    return undefined;
  }
  const average = performanceSummary.averageCpuUtilizationPercent;
  if (typeof average !== 'number' || !Number.isFinite(average)) {
    return undefined;
  }
  return average;
}

function countInstances(summary: {
  instancesByState: Record<string, number>;
  resourcesByType: Record<string, number>;
}): number {
  if (typeof summary.resourcesByType.INSTANCE === 'number') {
    return summary.resourcesByType.INSTANCE;
  }
  return Object.values(summary.instancesByState).reduce((sum, n) => sum + n, 0);
}

function mapApiError(error: unknown): { code: LiveEc2DashboardErrorCode; message: string } {
  if (error instanceof Ec2DashboardApiError) {
    if (error.httpStatus === 401 || error.code === 'UNAUTHORIZED') {
      return { code: 'SESSION_EXPIRED', message: 'Your session expired. Sign in again to continue.' };
    }
    if (error.httpStatus === 403 || error.code === 'FORBIDDEN') {
      return {
        code: 'FORBIDDEN',
        message: 'You do not have permission to view EC2 data for this account.',
      };
    }
    if (error.httpStatus === 404 || error.code === 'NOT_FOUND') {
      return { code: 'ACCOUNT_NOT_FOUND', message: 'AWS account not found or not available.' };
    }
    return { code: 'UNKNOWN', message: 'Unable to load EC2 dashboard data. Try again later.' };
  }
  return { code: 'UNKNOWN', message: 'Unable to load EC2 dashboard data. Try again later.' };
}

export class LiveEc2DashboardDataProvider implements Ec2DashboardDataProvider {
  readonly mode = 'live' as const;

  async loadDashboard(input: Ec2DashboardLoadInput): Promise<Ec2DashboardViewModel> {
    const accessToken = input.accessToken?.trim();
    if (!accessToken) {
      return this.errorViewModel('AUTH_REQUIRED', 'Sign in to view live EC2 data.', input);
    }

    let accountId = input.accountId?.trim();
    const region = input.region?.trim() || 'us-east-1';
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!accountId) {
      try {
        const accounts = await listTenantAwsAccounts(accessToken);
        accountId = accounts.accounts[0]?.accountId;
      } catch (error) {
        const mapped = mapApiError(error);
        return this.errorViewModel(mapped.code, mapped.message, input);
      }
      if (!accountId) {
        return this.errorViewModel(
          'ACCOUNT_REQUIRED',
          'Select a connected AWS account to load live EC2 data.',
          input,
        );
      }
    }

    let summary;
    try {
      summary = await fetchEc2ResourceSummary(accessToken, accountId, region);
    } catch (error) {
      const mapped = mapApiError(error);
      return this.errorViewModel(mapped.code, mapped.message, input, accountId);
    }

    let costList;
    let costFailed = false;
    try {
      costList = await fetchEc2CostRecommendations(accessToken, accountId, region);
    } catch (error) {
      costFailed = true;
      const mapped = mapApiError(error);
      warnings.push(`Cost recommendations unavailable: ${mapped.message}`);
      errors.push(mapped.message);
    }

    let securitySummary;
    let securityFindingsList: Awaited<ReturnType<typeof fetchEc2SecurityFindings>> | undefined;
    let securityUnavailable = true;
    try {
      securitySummary = await fetchEc2SecuritySummary(accessToken, accountId, region);
      securityFindingsList = await fetchEc2SecurityFindings(accessToken, accountId, region);
      securityUnavailable = false;
    } catch (error) {
      if (error instanceof Ec2DashboardApiError && error.httpStatus === 404) {
        warnings.push('Security analysis not yet run for this account and region.');
      } else {
        const mapped = mapApiError(error);
        warnings.push(`Security analysis unavailable: ${mapped.message}`);
      }
    }

    const totalInstances = countInstances(summary);
    const runningInstances = summary.instancesByState.running ?? 0;
    const stoppedInstances = summary.instancesByState.stopped ?? 0;
    const securityFindings = (securityFindingsList?.items ?? []).map((item) => ({
      title: item.message,
      severity:
        item.severity === 'critical'
          ? ('Critical' as const)
          : item.severity === 'high'
            ? ('High' as const)
            : item.severity === 'medium'
              ? ('Medium' as const)
              : ('Low' as const),
      count: 1,
      remediation: item.recommendation,
    }));

    const securitySection =
      securityUnavailable || !securitySummary
        ? {
            status: 'NOT_ANALYZED' as const,
            findings: [] as Ec2SecurityFinding[],
            instancesAnalyzed: 0,
            message:
              securitySummary === undefined
                ? 'Security analysis not yet run. Start analysis from the EC2 security API.'
                : 'Security analysis unavailable.',
          }
        : {
            status:
              securitySummary.scoreAvailability === 'unavailable'
                ? ('NOT_ANALYZED' as const)
                : securitySummary.scoreAvailability === 'partial'
                  ? ('PARTIAL' as const)
                  : ('READY' as const),
            securityScore: securitySummary.securityScore ?? undefined,
            governanceScore: securitySummary.governanceScore ?? undefined,
            complianceScore: securitySummary.complianceScore ?? undefined,
            riskLevel: securitySummary.riskLevel,
            instancesAnalyzed: securitySummary.instancesAnalyzed,
            findings: securityFindings,
            message:
              securitySummary.warnings?.[0] ??
              (securitySummary.instancesAnalyzed === 0 &&
              securitySummary.scoreAvailability === 'complete'
                ? 'Security analysis completed — no EC2 instances in scope.'
                : securitySummary.scoreAvailability === 'partial'
                  ? securitySummary.warnings?.[0]
                  : undefined),
          };

    const rightsizing = (costList?.items ?? [])
      .filter((item) => isRightsizingCategory(item.category))
      .map(mapRightsizingOpportunity);

    const costRecommendations = (costList?.items ?? []).map((item) => ({
      recommendationId: item.recommendationId,
      category: item.category,
      severity: item.severity,
      confidenceLevel: item.confidenceLevel,
      resourceId: item.resourceId,
      title: item.title,
      recommendedAction: item.recommendedAction,
      businessJustification: item.businessJustification,
      pricingStatus: item.pricingStatus,
      pricingLabel: pricingStatusLabel(item.pricingStatus),
      estimatedMonthlySavings: item.estimatedMonthlySavings,
      validatedSavings: item.pricingStatus === 'VERIFIED_RATE',
    }));

    const validatedMonthlySavings = costList?.savingsSummary.validatedMonthlySavings ?? 0;
    const sampleEstimateMonthlySavings =
      costList?.savingsSummary.sampleEstimateMonthlySavings ?? 0;

    const dataStatus =
      totalInstances === 0 && (costList?.items.length ?? 0) === 0
        ? 'EMPTY'
        : costFailed
          ? 'PARTIAL'
          : summary.staleResourceCount > 0
            ? 'STALE'
            : 'READY';

    const priorityRecommendations = costRecommendations.slice(0, 5).map((rec) => ({
      title: rec.title,
      category: 'cost' as const,
      priority:
        rec.severity === 'HIGH' ? ('High' as const) : rec.severity === 'MEDIUM' ? ('Medium' as const) : ('Low' as const),
      impact:
        rec.validatedSavings && rec.estimatedMonthlySavings !== undefined
          ? `$${rec.estimatedMonthlySavings.toFixed(2)}/mo validated`
          : rec.estimatedMonthlySavings !== undefined
            ? `$${rec.estimatedMonthlySavings.toFixed(2)}/mo sample estimate`
            : 'Pricing unavailable',
      detail: rec.businessJustification,
    }));

    const fleetSavingsAvailable = hasVerifiedRatePricingContext(costRecommendations);

    return {
      mode: 'live',
      dataStatus,
      sourceLabel: 'LIVE AWS DATA',
      title: 'EC2 Decision Dashboard',
      subtitle: 'Tenant-scoped inventory and recommendations from connected AWS accounts.',
      accountLabel: `Account ${maskAccountId(accountId)}`,
      accountIdSuffix: maskAccountId(accountId),
      region,
      generatedAt: new Date().toISOString(),
      lastDiscoveryAt: summary.latestSuccessfulDiscoveryAt,
      latestCostAnalysisAt:
        costList?.performanceSummary?.analyzedAt ?? costList?.items[0]?.analyzedAt,
      latestSecurityAnalysisAt: securitySummary?.analyzedAt ?? undefined,
      freshnessStatus: summary.staleResourceCount > 0 ? 'Discovery data may be stale' : undefined,
      inventory: {
        totalResources: summary.totalResources,
        totalInstances,
        runningInstances,
        stoppedInstances,
        instancesByState: summary.instancesByState,
        instancesByType: summary.instancesByInstanceType,
        resourcesByType: summary.resourcesByType,
      },
      cost: {
        validatedMonthlySavings,
        sampleEstimateMonthlySavings,
        estimatedMonthlyCost: undefined,
        pricingStatus: costFailed ? 'UNAVAILABLE' : 'UNAVAILABLE',
        pricingLabel: pricingStatusLabel('UNAVAILABLE'),
        recommendations: costRecommendations,
      },
      security: securitySection,
      optimization: {
        totalOpportunities: costRecommendations.length,
        idleCandidates: costRecommendations.filter((r) => r.category.includes('IDLE')).length,
        downsizeCandidates: costRecommendations.filter((r) => r.category === 'REVIEW_DOWNSIZE').length,
        upsizeCandidates: costRecommendations.filter((r) => r.category === 'REVIEW_UPSIZE').length,
        stoppedWithStorage: costRecommendations.filter((r) => r.category === 'STOPPED_WITH_STORAGE').length,
        rightsizing,
      },
      executive: {
        title:
          totalInstances === 0
            ? 'No EC2 instances discovered'
            : 'EC2 optimization overview',
        headline:
          totalInstances === 0
            ? 'This account has no EC2 instances. Other EC2 resource types may still appear in inventory.'
            : 'Review cost recommendations and refresh discovery to keep inventory current.',
        savings: validatedMonthlySavings,
        savingsUnavailable: !fleetSavingsAvailable,
        securityRisk:
          securitySection.status === 'READY' || securitySection.status === 'PARTIAL'
            ? securitySummary?.instancesAnalyzed === 0
              ? 'Analysis complete — no EC2 instances in scope'
              : `${securitySection.riskLevel ?? 'unknown'} risk · ${securitySummary?.openFindingCount ?? securityFindings.length} open findings`
            : 'Security analysis not yet run',
        priority: costRecommendations.some((r) => r.severity === 'HIGH') ? 'High' : 'Medium',
        confidence:
          securitySection.status === 'READY' || securitySection.status === 'PARTIAL'
            ? (securitySummary?.complianceScore ?? 0)
            : 0,
      },
      health: {
        healthy: runningInstances,
        warning: stoppedInstances,
        critical: 0,
        unknown: totalInstances === 0 ? 1 : 0,
      },
      averageCpuUtilization: mapAverageCpuUtilization(costList?.performanceSummary),
      warnings,
      errors: costFailed ? errors : [],
      reports: {
        format: 'json',
        available: true,
        label: 'EC2 JSON export',
      },
      priorityRecommendations,
    };
  }

  private errorViewModel(
    _code: LiveEc2DashboardErrorCode,
    message: string,
    input: Ec2DashboardLoadInput,
    accountId?: string,
  ): Ec2DashboardViewModel {
    return {
      mode: 'live',
      dataStatus: 'ERROR',
      sourceLabel: 'LIVE AWS DATA',
      title: 'EC2 Decision Dashboard',
      subtitle: message,
      accountLabel: accountId ? `Account ${maskAccountId(accountId)}` : undefined,
      accountIdSuffix: accountId ? maskAccountId(accountId) : undefined,
      region: input.region ?? 'us-east-1',
      generatedAt: new Date().toISOString(),
      inventory: {
        totalResources: 0,
        totalInstances: 0,
        runningInstances: 0,
        stoppedInstances: 0,
        instancesByState: {},
        instancesByType: {},
        resourcesByType: {},
      },
      cost: {
        validatedMonthlySavings: 0,
        sampleEstimateMonthlySavings: 0,
        pricingStatus: 'UNAVAILABLE',
        pricingLabel: pricingStatusLabel('UNAVAILABLE'),
        recommendations: [],
      },
      security: {
        status: 'UNAVAILABLE',
        findings: [],
        message: 'Security analysis unavailable.',
      },
      optimization: {
        totalOpportunities: 0,
        idleCandidates: 0,
        downsizeCandidates: 0,
        upsizeCandidates: 0,
        stoppedWithStorage: 0,
        rightsizing: [],
      },
      executive: {
        title: 'Unable to load EC2 dashboard',
        headline: message,
        savings: 0,
        savingsUnavailable: true,
        securityRisk: 'Unavailable',
        priority: 'Medium',
        confidence: 0,
      },
      health: { healthy: 0, warning: 0, critical: 0, unknown: 0 },
      warnings: [],
      errors: [message],
      reports: { format: 'json', available: false, label: 'Report unavailable' },
      priorityRecommendations: [],
    };
  }
}
