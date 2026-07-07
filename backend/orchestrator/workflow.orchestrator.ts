import type { OptimizationPlugin } from '../shared/interfaces';
import type {
  EvidenceEngineInterface,
} from '../shared/interfaces';
import type {
  Evidence,
  EvidencePackage,
  OptimizationContext,
  StandardizedEvidence,
  WorkflowResult,
} from '../shared/types';
import {
  PLATFORM_MODE,
  PROVIDER_NAMES,
  WORKFLOW_STAGES,
  WORKFLOW_STATES,
  type PluginName,
} from '../shared/constants';
import { createLogger, generateWorkflowId } from '../shared/utils';

const logger = createLogger('WorkflowOrchestrator');

export interface WorkflowOrchestratorDependencies {
  evidenceEngine: EvidenceEngineInterface;
  governanceEngine: import('../shared/interfaces').GovernanceEngineInterface;
  financialEngine: import('../shared/interfaces').FinancialEngineInterface;
  verificationEngine: import('../shared/interfaces').VerificationEngineInterface;
  getPlugin: (name: PluginName) => OptimizationPlugin;
}

export interface RunWorkflowRequest {
  plugin: PluginName;
  resourceId?: string;
  region?: string;
}

export interface RunEvidenceWorkflowRequest extends RunWorkflowRequest {}

function toLegacyEvidence(
  evidencePackage: EvidencePackage,
  standardized: StandardizedEvidence
): Evidence {
  return {
    resourceId: evidencePackage.candidate.resourceId,
    resourceType: evidencePackage.candidate.resourceType,
    region: evidencePackage.candidate.region,
    status: evidencePackage.status,
    cpuUtilization: standardized.telemetry.cpuUtilization,
    memoryUtilization: standardized.telemetry.memoryUtilization,
    networkUtilization: standardized.telemetry.networkUtilization,
    monthlyCost: standardized.pricing.monthlyRate,
    instanceType: standardized.instance.instanceType,
    recommendedInstanceType: standardized.recommendations[0]?.target,
    tags: standardized.tags,
    metrics: {
      cpuUtilization: standardized.metrics.cpuUtilization,
      memoryUtilization: standardized.metrics.memoryUtilization,
    },
    collectedAt: standardized.collectedAt,
  };
}

/**
 * Workflow Orchestrator — coordinates engines and plugins through the optimization lifecycle.
 * Sprint 2: evidence collection workflow implemented. Later stages remain placeholders.
 */
export class WorkflowOrchestrator {
  constructor(private readonly deps: WorkflowOrchestratorDependencies) {}

  async runEvidenceWorkflow(request: RunEvidenceWorkflowRequest): Promise<EvidencePackage> {
    const workflowId = generateWorkflowId();
    const start = Date.now();
    const region = request.region ?? 'us-east-1';

    const context: OptimizationContext = {
      workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
    };

    logger.info('Starting evidence workflow', {
      workflowId,
      plugin: request.plugin,
      operation: 'runEvidenceWorkflow',
    });

    const plugin = this.deps.getPlugin(request.plugin);
    const candidates = await plugin.collectCandidates();
    const candidate =
      candidates.find((item) => item.resourceId === request.resourceId) ?? candidates[0];

    if (!candidate) {
      throw new Error('No optimization candidates found');
    }

    context.candidate = candidate;

    const providerData = await plugin.collectProviderEvidence(candidate);
    const evidenceResult = await this.deps.evidenceEngine.execute({
      context,
      candidate,
      providerData,
    });

    if (!evidenceResult.success || !evidenceResult.data) {
      throw new Error(evidenceResult.error?.reason ?? 'Evidence collection failed');
    }

    logger.info('Evidence workflow completed', {
      workflowId,
      plugin: request.plugin,
      durationMs: Date.now() - start,
      status: evidenceResult.data.status,
    });

    return evidenceResult.data.package;
  }

  async runDemoWorkflow(request: RunWorkflowRequest): Promise<WorkflowResult> {
    const evidencePackage = await this.runEvidenceWorkflow(request);
    const legacyEvidence = toLegacyEvidence(evidencePackage, evidencePackage.evidence);
    const plugin = this.deps.getPlugin(request.plugin);

    const qualification = await plugin.qualify(legacyEvidence);
    const readiness = await plugin.scoreReadiness(legacyEvidence);
    const confidence = await plugin.scoreConfidence(legacyEvidence);
    const recommendation = await plugin.recommend(legacyEvidence);

    const context = {
      workflowId: evidencePackage.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: evidencePackage.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: evidencePackage.candidate,
    };

    const governanceResult = await this.deps.governanceEngine.execute({
      context,
      evidence: legacyEvidence,
      recommendation,
    });
    if (!governanceResult.success || !governanceResult.data) {
      throw new Error(governanceResult.error?.reason ?? 'Governance evaluation failed');
    }

    const financialResult = await this.deps.financialEngine.execute({
      context,
      evidence: legacyEvidence,
      recommendation,
    });
    if (!financialResult.success || !financialResult.data) {
      throw new Error(financialResult.error?.reason ?? 'Financial calculation failed');
    }

    const pluginFinancial = await plugin.estimateFinancialImpact(recommendation);
    const verificationResult = await this.deps.verificationEngine.execute({
      context,
      recommendation,
      financialImpact: financialResult.data,
    });
    if (!verificationResult.success || !verificationResult.data) {
      throw new Error(verificationResult.error?.reason ?? 'Verification failed');
    }

    return {
      workflowId: evidencePackage.workflowId,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.VERIFICATION,
      context,
      candidate: evidencePackage.candidate,
      evidence: legacyEvidence,
      qualification,
      readiness,
      confidence,
      recommendation,
      governance: governanceResult.data,
      financialImpact: pluginFinancial,
      verification: verificationResult.data,
      completedAt: new Date().toISOString(),
    };
  }
}

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies
): WorkflowOrchestrator {
  return new WorkflowOrchestrator(deps);
}
