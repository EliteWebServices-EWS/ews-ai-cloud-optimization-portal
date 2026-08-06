import { randomUUID } from 'node:crypto';

import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import type { Ec2CloudResourceRepository } from '../../repositories/contracts/ec2-cloud-resource-repository';
import type {
  Ec2CostAnalysisRunRepository,
  Ec2CostRecommendationRepository,
} from '../../repositories/contracts/ec2-cost-repository';
import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';
import {
  EC2_COST_DEFAULT_PERIOD_SECONDS,
  EC2_COST_MAX_INSTANCES_PER_REQUEST,
} from './ec2-cost-limits';
import { createEc2CostRuleRegistry } from './ec2-cost-rule-registry';
import { ALL_EC2_COST_RULES } from './ec2-cost-rules';
import { toEc2CostMetricsAppError } from './ec2-cost-metrics-errors';
import {
  shouldResolveOpenRecommendation,
  type Ec2CostResolutionContext,
} from './ec2-cost-resolution-policy';
import type { Ec2PerformanceMetricsClientFactory } from './ec2-performance-metrics-client.port';
import type { Ec2PerformanceEvidence } from './ec2-cost-models';

export interface Ec2CostAnalysisOrchestratorInput {
  tenantId: string;
  accountId: string;
  regions: string[];
  observationDays: number;
  runId: string;
  requestedAt: string;
  startedAt: string;
  metricsClientFactory?: Ec2PerformanceMetricsClientFactory;
}

export interface Ec2CostAnalysisOrchestratorResult {
  runId: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  instancesFound: number;
  instancesEvaluated: number;
  recommendationsCreated: number;
  recommendationsUpdated: number;
  recommendationsResolved: number;
  insufficientDataCount: number;
  regionsSucceeded: string[];
  regionsFailed: string[];
  warnings: string[];
  recommendationCounts: Record<string, number>;
}

function isAnalyzableInstance(record: DiscoveredCloudResourceRecord): boolean {
  if (record.resourceType !== 'INSTANCE') {
    return false;
  }
  if (record.status === 'NOT_SEEN' || record.status === 'STALE') {
    return false;
  }
  return record.status === 'ACTIVE';
}

export class Ec2CostAnalysisOrchestrator {
  private readonly ruleRegistry = createEc2CostRuleRegistry(ALL_EC2_COST_RULES);

  constructor(
    private readonly resources: Ec2CloudResourceRepository,
    private readonly recommendations: Ec2CostRecommendationRepository,
    private readonly runs: Ec2CostAnalysisRunRepository,
  ) {}

  async run(input: Ec2CostAnalysisOrchestratorInput): Promise<Ec2CostAnalysisOrchestratorResult> {
    const warnings: string[] = [];
    const recommendationCounts: Record<string, number> = {};
    let instancesFound = 0;
    let instancesEvaluated = 0;
    let insufficientDataCount = 0;
    let recommendationsCreated = 0;
    let recommendationsUpdated = 0;
    let recommendationsResolved = 0;
    const regionsSucceeded: string[] = [];
    const regionsFailed: string[] = [];
    const seenFindingKeys = new Set<string>();

    const runRecord = await this.runs.createRun({
      runId: input.runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      regions: input.regions,
      observationDays: input.observationDays,
      periodSeconds: EC2_COST_DEFAULT_PERIOD_SECONDS,
      requestedAt: input.requestedAt,
      startedAt: input.startedAt,
    });

    const instancesByRegion = new Map<string, DiscoveredCloudResourceRecord[]>();
    const volumesByRegion = new Map<string, DiscoveredCloudResourceRecord[]>();

    for (const region of input.regions) {
      const instances = await this.resources.listResourcesInScope({
        tenantId: input.tenantId,
        accountId: input.accountId,
        region,
        resourceType: 'INSTANCE',
      });
      const skipped = instances.filter(
        (i) => i.status === 'NOT_SEEN' || i.status === 'STALE',
      ).length;
      if (skipped > 0) {
        warnings.push(
          `${region}: ignored ${skipped} INSTANCE record(s) with NOT_SEEN or STALE status.`,
        );
      }
      const active = instances.filter(isAnalyzableInstance);
      instancesByRegion.set(region, active);
      instancesFound += active.length;

      const volumes = await this.resources.listResourcesInScope({
        tenantId: input.tenantId,
        accountId: input.accountId,
        region,
        resourceType: 'VOLUME',
      });
      volumesByRegion.set(
        region,
        volumes.filter((v) => v.status === 'ACTIVE'),
      );
    }

    if (instancesFound > EC2_COST_MAX_INSTANCES_PER_REQUEST) {
      await this.runs.completeRun({
        tenantId: input.tenantId,
        accountId: input.accountId,
        runId: input.runId,
        expectedVersion: runRecord.version,
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        instancesFound,
        instancesEvaluated: 0,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        recommendationsResolved: 0,
        insufficientDataCount: 0,
        regionsSucceeded: [],
        regionsFailed: input.regions,
        warnings: [
          `More than ${EC2_COST_MAX_INSTANCES_PER_REQUEST} instances were found; narrow regions or reduce inventory scope.`,
        ],
      });
      throw new Error('EC2_COST_INSTANCE_LIMIT_EXCEEDED');
    }

    if (instancesFound === 0) {
      warnings.push(
        'No ACTIVE EC2 INSTANCE inventory records were found for the requested scope; CloudWatch was not called.',
      );
      const resolved = await this.resolveStaleFindings(
        input,
        {
          runStatus: 'SUCCEEDED',
          requestedRegions: input.regions,
          regionsFailed: [],
          seenFindingKeys,
          currentRuleVersions: this.currentRuleVersions(),
        },
      );
      recommendationsResolved += resolved;
      await this.runs.completeRun({
        tenantId: input.tenantId,
        accountId: input.accountId,
        runId: input.runId,
        expectedVersion: runRecord.version,
        status: 'SUCCEEDED',
        completedAt: new Date().toISOString(),
        instancesFound: 0,
        instancesEvaluated: 0,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        recommendationsResolved,
        insufficientDataCount: 0,
        regionsSucceeded: input.regions,
        regionsFailed: [],
        warnings,
      });
      return {
        runId: input.runId,
        status: 'SUCCEEDED',
        instancesFound: 0,
        instancesEvaluated: 0,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        recommendationsResolved,
        insufficientDataCount: 0,
        regionsSucceeded: input.regions,
        regionsFailed: [],
        warnings,
        recommendationCounts,
      };
    }

    if (!input.metricsClientFactory) {
      await this.runs.completeRun({
        tenantId: input.tenantId,
        accountId: input.accountId,
        runId: input.runId,
        expectedVersion: runRecord.version,
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        instancesFound,
        instancesEvaluated: 0,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        recommendationsResolved: 0,
        insufficientDataCount: 0,
        regionsSucceeded: [],
        regionsFailed: input.regions,
        warnings: ['CloudWatch metrics client was not configured for this analysis.'],
      });
      throw new Error('EC2_COST_METRICS_CLIENT_MISSING');
    }

    const evidenceByInstance = new Map<string, Ec2PerformanceEvidence>();
    const endTime = new Date();

    for (const region of input.regions) {
      const regionInstances = instancesByRegion.get(region) ?? [];
      if (regionInstances.length === 0) {
        regionsSucceeded.push(region);
        continue;
      }
      try {
        const client = input.metricsClientFactory(region);
        const evidenceList = await client.collectMetrics({
          region,
          targets: regionInstances.map((inst) => ({
            region,
            instanceId: inst.resourceId,
            instanceType:
              typeof inst.metadata.instanceType === 'string'
                ? inst.metadata.instanceType
                : undefined,
          })),
          observationDays: input.observationDays,
          periodSeconds: EC2_COST_DEFAULT_PERIOD_SECONDS,
          endTime,
        });
        for (const evidence of evidenceList) {
          evidenceByInstance.set(`${region}#${evidence.instanceId}`, evidence);
          if (
            evidence.dataCompleteness === 'INSUFFICIENT' ||
            evidence.dataCompleteness === 'NO_DATA'
          ) {
            insufficientDataCount += 1;
          }
        }
        instancesEvaluated += regionInstances.length;
        regionsSucceeded.push(region);
      } catch (error) {
        regionsFailed.push(region);
        warnings.push(`${region}: metrics collection failed (${toEc2CostMetricsAppError(error).code}).`);
      }
    }

    for (const region of input.regions) {
      const regionInstances = instancesByRegion.get(region) ?? [];
      const volumes = volumesByRegion.get(region) ?? [];
      for (const instance of regionInstances) {
        const evidence = evidenceByInstance.get(`${region}#${instance.resourceId}`);
        for (const rule of this.ruleRegistry.list()) {
          const results = rule.evaluate({
            tenantId: input.tenantId,
            accountId: input.accountId,
            region,
            instance,
            volumes,
            evidence,
            analysisRunId: input.runId,
            observationDays: input.observationDays,
          });
          for (const result of results) {
            if (result.category === 'INSUFFICIENT_DATA') {
              insufficientDataCount += 1;
            }
            const findingKey = buildEc2CostFindingKey({
              tenantId: input.tenantId,
              accountId: input.accountId,
              region,
              resourceId: result.resourceId,
              category: result.category,
              ruleVersion: rule.ruleVersion,
            });
            seenFindingKeys.add(findingKey);
            recommendationCounts[result.category] =
              (recommendationCounts[result.category] ?? 0) + 1;

            const saved = await this.recommendations.upsertRecommendation({
              findingKey,
              recommendation: {
                tenantId: input.tenantId,
                accountId: input.accountId,
                region,
                service: 'ec2',
                resourceType: result.resourceType,
                resourceId: result.resourceId,
                category: result.category,
                severity: result.severity,
                confidenceScore: result.confidenceScore,
                confidenceLevel: result.confidenceLevel,
                title: result.title,
                summary: result.summary,
                businessJustification: result.businessJustification,
                recommendedAction: result.recommendedAction,
                evidenceSummary: result.evidenceSummary,
                observedValues: result.observedValues,
                thresholds: result.thresholds,
                currentInstanceType: result.currentInstanceType,
                candidateInstanceType: result.candidateInstanceType,
                currentMonthlyCost: result.currentMonthlyCost,
                projectedMonthlyCost: result.projectedMonthlyCost,
                estimatedMonthlySavings: result.estimatedMonthlySavings,
                estimatedAnnualSavings: result.estimatedAnnualSavings,
                currency:
                  result.pricingStatus === 'CONTROLLED_CATALOG_SAMPLE' ||
                  result.pricingStatus === 'VERIFIED_RATE'
                    ? 'USD'
                    : undefined,
                pricingAssumptions: result.pricingAssumptions,
                pricingStatus: result.pricingStatus,
                analysisRunId: input.runId,
                ruleId: rule.ruleId,
                ruleVersion: rule.ruleVersion,
                findingKey,
                recommendationId: `ec2cost-${randomUUID()}`,
              },
            });
            if (saved.version === 1) {
              recommendationsCreated += 1;
            } else {
              recommendationsUpdated += 1;
            }
          }
        }
      }
    }

    let status: Ec2CostAnalysisOrchestratorResult['status'] = 'SUCCEEDED';
    if (regionsFailed.length > 0 && regionsSucceeded.length > 0) {
      status = 'PARTIAL';
    } else if (regionsFailed.length === input.regions.length) {
      status = 'FAILED';
    }

    if (status === 'SUCCEEDED') {
      recommendationsResolved += await this.resolveStaleFindings(input, {
        runStatus: 'SUCCEEDED',
        requestedRegions: input.regions,
        regionsFailed: [],
        seenFindingKeys,
        currentRuleVersions: this.currentRuleVersions(),
      });
    }

    await this.runs.completeRun({
      tenantId: input.tenantId,
      accountId: input.accountId,
      runId: input.runId,
      expectedVersion: runRecord.version,
      status,
      completedAt: new Date().toISOString(),
      instancesFound,
      instancesEvaluated,
      recommendationsCreated,
      recommendationsUpdated,
      recommendationsResolved,
      insufficientDataCount,
      regionsSucceeded,
      regionsFailed,
      warnings,
    });

    return {
      runId: input.runId,
      status,
      instancesFound,
      instancesEvaluated,
      recommendationsCreated,
      recommendationsUpdated,
      recommendationsResolved,
      insufficientDataCount,
      regionsSucceeded,
      regionsFailed,
      warnings,
      recommendationCounts,
    };
  }

  private currentRuleVersions(): Map<string, string> {
    return new Map(this.ruleRegistry.list().map((r) => [r.ruleId, r.ruleVersion]));
  }

  private async resolveStaleFindings(
    input: Pick<Ec2CostAnalysisOrchestratorInput, 'tenantId' | 'accountId'>,
    ctx: Ec2CostResolutionContext,
  ): Promise<number> {
    let resolved = 0;
    let nextToken: string | undefined;
    do {
      const page = await this.recommendations.listRecommendations({
        tenantId: input.tenantId,
        accountId: input.accountId,
        lifecycleStatus: 'OPEN',
        limit: 100,
        nextToken,
      });
      for (const rec of page.items) {
        if (!shouldResolveOpenRecommendation(rec, ctx)) {
          continue;
        }
        await this.recommendations.markResolved({
          tenantId: input.tenantId,
          accountId: input.accountId,
          findingKey: rec.findingKey,
          expectedVersion: rec.version,
          resolvedAt: new Date().toISOString(),
        });
        resolved += 1;
      }
      nextToken = page.nextToken;
    } while (nextToken);
    return resolved;
  }
}
