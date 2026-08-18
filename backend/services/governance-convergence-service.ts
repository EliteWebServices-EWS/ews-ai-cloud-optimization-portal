import { buildGovernanceConvergenceFindingKey } from '../database/cloud-resources/governance-convergence-keys';
import { EC2_SECURITY_RULE_VERSION } from '../database';
import type { Ec2SecurityAnalysisResponse } from '../engines/ec2-security/ec2-security.types';
import {
  authoritativeRegionsForGovernanceAbsence,
  isAuthoritativeForGovernanceAbsence,
  isRunAuthoritativeForMissingReconciliation,
  type GovernanceRunAuthorityContext,
} from '../governance-convergence/governance-convergence-authority';
import {
  deriveGovernanceEvidenceFromFindings,
  GOVERNANCE_TRACKED_CHECK_LIST,
} from '../governance-convergence/governance-evidence-reuse';
import type { CloudResourceLifecycleStatus } from '../repositories/models/cloud-resource-persistence-models';
import type { Ec2CloudResourceRepository } from '../repositories/contracts/ec2-cloud-resource-repository';
import type { GovernanceConvergenceRepository } from '../repositories/contracts/governance-convergence-repository';

export interface GovernanceActiveInventoryInstance {
  instanceId: string;
  region: string;
  lifecycleStatus: CloudResourceLifecycleStatus;
}

export interface PersistGovernanceConvergenceForSecurityRunInput {
  tenantId: string;
  accountId: string;
  analysisRunId: string;
  analysisRunStartedAt: string;
  analysis: Ec2SecurityAnalysisResponse;
  instanceRegions: Map<string, string>;
  observationTimestamp: string;
  collectionTimestamp: string;
  authority: GovernanceRunAuthorityContext;
  activeInventoryInstances: readonly GovernanceActiveInventoryInstance[];
}

export interface PersistGovernanceConvergenceForSecurityRunResult {
  observationsRecorded: number;
  resultsRecorded: number;
  missingRecorded: number;
  warnings: string[];
}

interface CurrentRunObservationState {
  currentObservedKeys: Set<string>;
  persistenceFailedFindingKeys: Set<string>;
  analysisInstanceIds: Set<string>;
  lifecycleByInstanceId: Map<string, CloudResourceLifecycleStatus>;
}

export class GovernanceConvergenceService {
  constructor(
    private readonly repository: GovernanceConvergenceRepository,
    private readonly resources?: Ec2CloudResourceRepository,
  ) {}

  async persistForSecurityAnalysisRun(
    input: PersistGovernanceConvergenceForSecurityRunInput,
  ): Promise<PersistGovernanceConvergenceForSecurityRunResult> {
    const warnings: string[] = [];
    let observationsRecorded = 0;
    let resultsRecorded = 0;

    const observationState = await this.recordCurrentRunObservations(input, warnings, {
      onObservationRecorded: () => {
        observationsRecorded += 1;
      },
      onResultRecorded: () => {
        resultsRecorded += 1;
      },
    });

    let missingRecorded = 0;
    if (isRunAuthoritativeForMissingReconciliation(input.authority)) {
      missingRecorded = await this.reconcileLiveMissingEvidence(input, observationState, warnings);
    }

    return { observationsRecorded, resultsRecorded, missingRecorded, warnings };
  }

  /** Production records every expected control. Override in tests only to simulate absence. */
  protected shouldRecordCurrentObservation(_findingKey: string): boolean {
    return true;
  }

  protected async recordCurrentRunObservations(
    input: PersistGovernanceConvergenceForSecurityRunInput,
    warnings: string[],
    counters?: {
      onObservationRecorded?: () => void;
      onResultRecorded?: () => void;
    },
  ): Promise<CurrentRunObservationState> {
    const currentObservedKeys = new Set<string>();
    const persistenceFailedFindingKeys = new Set<string>();
    const analysisInstanceIds = new Set<string>();
    const lifecycleByInstanceId = new Map<string, CloudResourceLifecycleStatus>();

    for (const instance of input.activeInventoryInstances) {
      lifecycleByInstanceId.set(instance.instanceId, instance.lifecycleStatus);
    }

    for (const result of input.analysis.results) {
      analysisInstanceIds.add(result.instanceId);
      const region = input.instanceRegions.get(result.instanceId) ?? 'us-east-1';
      const combinedFindings = [...result.securityFindings, ...result.governanceFindings];
      const lifecycleStatus =
        lifecycleByInstanceId.get(result.instanceId) ??
        input.activeInventoryInstances.find((item) => item.instanceId === result.instanceId)
          ?.lifecycleStatus;

      for (const check of GOVERNANCE_TRACKED_CHECK_LIST) {
        const findingKey = buildGovernanceConvergenceFindingKey({
          tenantId: input.tenantId,
          accountId: input.accountId,
          region,
          resourceId: result.instanceId,
          check,
        });

        if (!this.shouldRecordCurrentObservation(findingKey)) {
          continue;
        }

        try {
          const evidence = deriveGovernanceEvidenceFromFindings(
            combinedFindings,
            check,
            EC2_SECURITY_RULE_VERSION,
          );

          const recorded = await this.repository.recordObservation({
            tenantId: input.tenantId,
            accountId: input.accountId,
            region,
            resourceId: result.instanceId,
            check,
            findingKey,
            analysisRunId: input.analysisRunId,
            analysisRunStartedAt: input.analysisRunStartedAt,
            observationTimestamp: input.observationTimestamp,
            collectionTimestamp: input.collectionTimestamp,
            evidence,
          });

          if (recorded.created) {
            counters?.onObservationRecorded?.();
          }
          if (recorded.result) {
            counters?.onResultRecorded?.();
          }

          currentObservedKeys.add(findingKey);
          await this.repository.upsertLatestObservedControl({
            tenantId: input.tenantId,
            accountId: input.accountId,
            region,
            resourceId: result.instanceId,
            check,
            findingKey,
            latestObservationId: recorded.observation.observationId,
            latestLogicalObservationId: recorded.observation.logicalObservationId,
            latestObservationTimestamp: recorded.observation.observationTimestamp,
            latestAnalysisRunId: recorded.observation.analysisRunId,
            latestRuleVersion: recorded.observation.evidence.ruleVersion,
            resourceLifecycleStatus: lifecycleStatus,
          });
        } catch (error) {
          persistenceFailedFindingKeys.add(findingKey);
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(
            `Governance convergence failed for ${result.instanceId}/${check}: ${message}`,
          );
        }
      }
    }

    return {
      currentObservedKeys,
      persistenceFailedFindingKeys,
      analysisInstanceIds,
      lifecycleByInstanceId,
    };
  }

  protected async reconcileLiveMissingEvidence(
    input: PersistGovernanceConvergenceForSecurityRunInput,
    state: CurrentRunObservationState,
    warnings: string[],
  ): Promise<number> {
    const authoritativeRegions = authoritativeRegionsForGovernanceAbsence(input.authority);
    if (authoritativeRegions.length === 0) {
      return 0;
    }

    let missingRecorded = 0;
    let nextToken: string | undefined;
    const lifecycleCache = new Map<string, CloudResourceLifecycleStatus>();

    do {
      const page = await this.repository.listLatestObservedControls({
        tenantId: input.tenantId,
        accountId: input.accountId,
        regions: authoritativeRegions,
        limit: 100,
        nextToken,
      });

      for (const checkpoint of page.items) {
        if (state.currentObservedKeys.has(checkpoint.findingKey)) {
          continue;
        }
        if (state.persistenceFailedFindingKeys.has(checkpoint.findingKey)) {
          continue;
        }
        if (!state.analysisInstanceIds.has(checkpoint.resourceId)) {
          continue;
        }

        const lifecycleStatus = await this.resolveResourceLifecycleStatus(
          input.tenantId,
          input.accountId,
          checkpoint.region,
          checkpoint.resourceId,
          state.lifecycleByInstanceId,
          lifecycleCache,
        );
        if (lifecycleStatus !== 'ACTIVE') {
          continue;
        }

        if (
          !isAuthoritativeForGovernanceAbsence({
            requestedRegion: checkpoint.region,
            discoveryRegionsSucceeded: input.authority.discoveryRegionsSucceeded,
            discoveryRegionsFailed: input.authority.discoveryRegionsFailed,
            discoveryRunStatus: input.authority.discoveryRunStatus,
            securityRunStatus: input.authority.securityRunStatus,
            resourceLifecycleStatus: lifecycleStatus,
          })
        ) {
          continue;
        }

        try {
          const missing = await this.repository.recordMissingEvidence({
            tenantId: input.tenantId,
            accountId: input.accountId,
            findingKey: checkpoint.findingKey,
            analysisRunId: input.analysisRunId,
            evaluatedAt: input.observationTimestamp,
          });
          if (missing) {
            missingRecorded += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(
            `Governance MISSING reconciliation failed for ${checkpoint.findingKey}: ${message}`,
          );
        }
      }

      nextToken = page.nextToken;
    } while (nextToken);

    return missingRecorded;
  }

  private async resolveResourceLifecycleStatus(
    tenantId: string,
    accountId: string,
    region: string,
    resourceId: string,
    activeInventory: Map<string, CloudResourceLifecycleStatus>,
    cache: Map<string, CloudResourceLifecycleStatus>,
  ): Promise<CloudResourceLifecycleStatus | undefined> {
    const cacheKey = `${region}#${resourceId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const fromInventory = activeInventory.get(resourceId);
    if (fromInventory) {
      cache.set(cacheKey, fromInventory);
      return fromInventory;
    }

    if (this.resources) {
      const resource = await this.resources.getResource({
        tenantId,
        accountId,
        region,
        resourceType: 'INSTANCE',
        resourceId,
      });
      if (resource) {
        cache.set(cacheKey, resource.status);
        return resource.status;
      }
    }

    return undefined;
  }
}
