import { randomUUID } from 'node:crypto';



import { buildEc2SecurityFindingKey, EC2_SECURITY_RULE_VERSION } from '../../database';

import { analyzeEc2Security, type Ec2GovernancePolicy } from '../../engines/ec2-security';

import type { Ec2CloudResourceRepository } from '../../repositories/contracts/ec2-cloud-resource-repository';

import type {

  Ec2SecurityAnalysisRunRepository,

  Ec2SecurityFindingRepository,

  Ec2SecuritySummaryRepository,

} from '../../repositories/contracts/ec2-security-repository';

import type { Ec2SecurityAnalysisRunRecord } from './ec2-security-models';

import { supplementAnalysisForInsufficientEvidence } from './ec2-security-evidence';

import {

  computeComplianceScore,

  indexVolumesByInstance,

  mapDiscoveredInstanceToSecurityInventory,

} from './ec2-security-inventory-mapper';

import { summarizeRegionalAnalysisResults } from './ec2-security-summary-aggregate';



export interface RunEc2SecurityAnalysisInput {

  tenantId: string;

  accountId: string;

  regions: string[];

  policy?: Ec2GovernancePolicy;

  /** When set (async worker), reuses a stable run id for idempotent stage recovery. */

  runId?: string;

  resumeRunExpectedVersion?: number;

  /** When false, OPEN findings outside the analyzed result set are not resolved. */

  resolveAbsentOpenFindings?: boolean;

  /** Run completion status override (for partial failure scenarios). */

  completionStatus?: Ec2SecurityAnalysisRunRecord['status'];

}



export interface RunEc2SecurityAnalysisResult {

  run: Ec2SecurityAnalysisRunRecord;

  summary: {

    securityScore: number | null;

    governanceScore: number | null;

    complianceScore: number | null;

    riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'unavailable';

    instancesAnalyzed: number;

    openFindingCount: number;

    analyzedAt: string;

    warnings: string[];

  };

}



function resolveFindingStatus(

  priorStatus: string | undefined,

  detectedAgain: boolean,

): 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED' | 'RESOLVED' {

  if (priorStatus === 'ACKNOWLEDGED' || priorStatus === 'DISMISSED') {

    return priorStatus;

  }

  if (priorStatus === 'RESOLVED') {

    return detectedAgain ? 'OPEN' : 'RESOLVED';

  }

  return 'OPEN';

}



export class Ec2SecurityAnalysisOrchestrator {

  constructor(

    private readonly resources: Ec2CloudResourceRepository,

    private readonly findings: Ec2SecurityFindingRepository,

    private readonly summaries: Ec2SecuritySummaryRepository,

    private readonly runs: Ec2SecurityAnalysisRunRepository,

  ) {}



  async runAnalysis(input: RunEc2SecurityAnalysisInput): Promise<RunEc2SecurityAnalysisResult> {

    const runId = input.runId ?? randomUUID();

    const startedAt = new Date().toISOString();

    let run: Ec2SecurityAnalysisRunRecord;
    if (input.resumeRunExpectedVersion != null) {
      const existing = await this.runs.getRun(input.tenantId, input.accountId, runId);
      if (
        !existing ||
        existing.status !== 'RUNNING' ||
        existing.version !== input.resumeRunExpectedVersion
      ) {
        throw new Error('EC2_SECURITY_RUN_EXECUTION_MISMATCH');
      }
      run = existing;
    } else {
      run = await this.runs.createRun({

      runId,

      tenantId: input.tenantId,

      accountId: input.accountId,

      regions: input.regions,

      startedAt,

    });
    }



    let instancesFound = 0;

    const inventory = [];

    const metadataByInstanceId = new Map<string, Record<string, unknown>>();

    const instanceRegion = new Map<string, string>();



    for (const region of input.regions) {

      const instances = await this.resources.listResourcesInScope({

        tenantId: input.tenantId,

        accountId: input.accountId,

        region,

        resourceType: 'INSTANCE',

      });

      const volumes = await this.resources.listResourcesInScope({

        tenantId: input.tenantId,

        accountId: input.accountId,

        region,

        resourceType: 'VOLUME',

      });

      const volumeIndex = indexVolumesByInstance(volumes);

      instancesFound += instances.length;

      for (const instance of instances) {

        metadataByInstanceId.set(instance.resourceId, instance.metadata ?? {});

        instanceRegion.set(instance.resourceId, region);

        inventory.push(

          mapDiscoveredInstanceToSecurityInventory(

            instance,

            volumeIndex.get(instance.resourceId) ?? [],

          ),

        );

      }

    }



    const warnings: string[] = [];

    if (instancesFound === 0) {
      warnings.push('No active EC2 instances were available in the requested scope.');
      const now = new Date().toISOString();
      const completionStatus = input.completionStatus ?? 'SUCCEEDED';
      let findingsResolved = 0;
      if (input.resolveAbsentOpenFindings !== false && completionStatus === 'SUCCEEDED') {
        const analyzedRegions = new Set(input.regions);
        const openBefore = await this.findings.listFindings({
          tenantId: input.tenantId,
          accountId: input.accountId,
          status: 'OPEN',
          limit: 500,
        });
        for (const item of openBefore.items) {
          if (!analyzedRegions.has(item.region)) {
            continue;
          }
          if (item.ruleVersion !== EC2_SECURITY_RULE_VERSION) {
            continue;
          }
          try {
            await this.findings.markResolved({
              tenantId: input.tenantId,
              accountId: input.accountId,
              findingKey: item.findingKey,
              expectedVersion: item.version,
              resolvedAt: now,
            });
            findingsResolved += 1;
          } catch {
            // Version conflict — leave finding open for a later rerun.
          }
        }
      }
      for (const region of input.regions) {
        const regionalSummary = summarizeRegionalAnalysisResults([]);
        await this.summaries.upsertSummary({
          tenantId: input.tenantId,
          accountId: input.accountId,
          region,
          securityScore: regionalSummary.securityScore,
          governanceScore: regionalSummary.governanceScore,
          complianceScore: regionalSummary.complianceScore,
          riskLevel: regionalSummary.riskLevel,
          instancesAnalyzed: 0,
          openFindingCount: 0,
          analyzedAt: now,
          analysisRunId: runId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      const completed = await this.runs.completeRun({
        tenantId: input.tenantId,
        accountId: input.accountId,
        runId,
        expectedVersion: run.version,
        status: completionStatus,
        completedAt: now,
        instancesFound: 0,
        instancesAnalyzed: 0,
        findingsCreated: 0,
        findingsUpdated: 0,
        findingsResolved,
      });

      return {

        run: completed,

        summary: {

          securityScore: null,

          governanceScore: null,

          complianceScore: null,

          riskLevel: 'unavailable',

          instancesAnalyzed: 0,

          openFindingCount: 0,

          analyzedAt: now,

          warnings,

        },

      };

    }



    const baseAnalysis = analyzeEc2Security(inventory, input.policy ?? {});

    const { analysis, supplement } = supplementAnalysisForInsufficientEvidence(

      inventory,

      baseAnalysis,

      metadataByInstanceId,

    );

    warnings.push(...supplement.warnings);



    const now = new Date().toISOString();

    const openKeysThisRun = new Set<string>();

    const analyzedRegions = new Set(input.regions);

    let findingsCreated = 0;

    let findingsUpdated = 0;



    const persistFinding = async (params: {

      region: string;

      instanceId: string;

      category: 'security' | 'governance';

      check: string;

      severity: 'critical' | 'high' | 'medium' | 'low';

      message: string;

      remediation: string;

    }) => {

      const findingKey = buildEc2SecurityFindingKey({

        tenantId: input.tenantId,

        accountId: input.accountId,

        region: params.region,

        resourceId: params.instanceId,

        check: params.check,

        ruleVersion: EC2_SECURITY_RULE_VERSION,

      });

      openKeysThisRun.add(findingKey);

      const existing = await this.findings.getFindingByKey(

        input.tenantId,

        input.accountId,

        findingKey,

      );

      const nextStatus = resolveFindingStatus(existing?.status, true);

      await this.findings.upsertFinding({

        findingKey,

        finding: {

          tenantId: input.tenantId,

          accountId: input.accountId,

          region: params.region,

          resourceId: params.instanceId,

          resourceType: 'INSTANCE',

          category: params.category,

          check: params.check,

          ruleVersion: EC2_SECURITY_RULE_VERSION,

          severity: params.severity,

          message: params.message,

          recommendation: params.remediation,

          analysisRunId: runId,

          status: nextStatus,

        },

      });

      if (existing) {

        findingsUpdated += 1;

      } else {

        findingsCreated += 1;

      }

    };



    for (const result of analysis.results) {

      const region = instanceRegion.get(result.instanceId) ?? input.regions[0] ?? 'us-east-1';

      for (const finding of result.securityFindings) {

        await persistFinding({

          region,

          instanceId: result.instanceId,

          category: 'security',

          check: finding.check,

          severity: finding.severity,

          message: finding.message,

          remediation: finding.remediation,

        });

      }

      for (const finding of result.governanceFindings) {

        await persistFinding({

          region,

          instanceId: result.instanceId,

          category: 'governance',

          check: finding.check,

          severity: finding.severity,

          message: finding.message,

          remediation: finding.remediation,

        });

      }

    }



    const completionStatus = input.completionStatus ?? 'SUCCEEDED';

    let findingsResolved = 0;

    if (input.resolveAbsentOpenFindings !== false && completionStatus === 'SUCCEEDED') {

      const openBefore = await this.findings.listFindings({

        tenantId: input.tenantId,

        accountId: input.accountId,

        status: 'OPEN',

        limit: 500,

      });

      for (const item of openBefore.items) {

        if (!analyzedRegions.has(item.region)) {

          continue;

        }

        if (item.ruleVersion !== EC2_SECURITY_RULE_VERSION) {

          continue;

        }

        if (openKeysThisRun.has(item.findingKey)) {

          continue;

        }

        try {

          await this.findings.markResolved({

            tenantId: input.tenantId,

            accountId: input.accountId,

            findingKey: item.findingKey,

            expectedVersion: item.version,

            resolvedAt: now,

          });

          findingsResolved += 1;

        } catch {

          // Version conflict — leave finding open for a later rerun.

        }

      }

    }



    const accountOpenList = await this.findings.listFindings({
      tenantId: input.tenantId,
      accountId: input.accountId,
      status: 'OPEN',
      limit: 500,
    });

    for (const region of input.regions) {
      const regionalResults = analysis.results.filter(
        (result) => (instanceRegion.get(result.instanceId) ?? region) === region,
      );
      const regionalSummary = summarizeRegionalAnalysisResults(regionalResults);
      const regionalOpenList = await this.findings.listFindings({
        tenantId: input.tenantId,
        accountId: input.accountId,
        region,
        status: 'OPEN',
        limit: 500,
      });
      await this.summaries.upsertSummary({
        tenantId: input.tenantId,
        accountId: input.accountId,
        region,
        securityScore: regionalSummary.securityScore,
        governanceScore: regionalSummary.governanceScore,
        complianceScore: regionalSummary.complianceScore,
        riskLevel: regionalSummary.riskLevel,
        instancesAnalyzed: regionalSummary.instancesAnalyzed,
        openFindingCount: regionalOpenList.items.length,
        analyzedAt: analysis.analyzedAt,
        analysisRunId: runId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    const complianceScore = computeComplianceScore(
      analysis.summary.securityScore,
      analysis.summary.governanceScore,
    );



    const completed = await this.runs.completeRun({

      tenantId: input.tenantId,

      accountId: input.accountId,

      runId,

      expectedVersion: run.version,

      status: completionStatus,

      completedAt: now,

      instancesFound,

      instancesAnalyzed: analysis.summary.instancesAnalyzed,

      findingsCreated,

      findingsUpdated,

      findingsResolved,

    });



    return {

      run: completed,

      summary: {

        securityScore: analysis.summary.securityScore,

        governanceScore: analysis.summary.governanceScore,

        complianceScore,

        riskLevel: analysis.summary.riskLevel,

        instancesAnalyzed: analysis.summary.instancesAnalyzed,

        openFindingCount: accountOpenList.items.length,

        analyzedAt: analysis.analyzedAt,

        warnings,

      },

    };

  }

}
