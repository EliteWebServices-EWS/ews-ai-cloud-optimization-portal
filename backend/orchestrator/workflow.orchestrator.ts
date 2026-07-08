import type { OptimizationPlugin, EvidenceEngineInterface } from '../shared/interfaces';
import type {
  EvidencePackage,
  FinancialWorkflowResult,
  GovernanceWorkflowResult,
  OptimizationContext,
  RecommendationWorkflowResult,
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
  confidenceEngine: import('../shared/interfaces').ConfidenceEngineInterface;
  recommendationEngine: import('../shared/interfaces').RecommendationEngineInterface;
  verificationEngine: import('../shared/interfaces').VerificationEngineInterface;
  getPlugin: (name: PluginName) => OptimizationPlugin;
}

export interface RunWorkflowRequest {
  plugin: PluginName;
  resourceId?: string;
  region?: string;
}

export interface RunEvidenceWorkflowRequest extends RunWorkflowRequest {}

export interface RunGovernanceWorkflowRequest extends RunWorkflowRequest {}

export interface RunFinancialWorkflowRequest extends RunWorkflowRequest {}

export interface RunRecommendationWorkflowRequest extends RunWorkflowRequest {}

/**
 * Workflow Orchestrator — coordinates engines and plugins through the optimization lifecycle.
 * Sprint 5: confidence and recommendation workflow implemented. Verification remains placeholder.
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

  async runGovernanceWorkflow(
    request: RunGovernanceWorkflowRequest
  ): Promise<GovernanceWorkflowResult> {
    const start = Date.now();
    const evidencePackage = await this.runEvidenceWorkflow(request);

    const context: OptimizationContext = {
      workflowId: evidencePackage.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: evidencePackage.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: evidencePackage.candidate,
    };

    logger.info('Starting governance workflow', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      operation: 'runGovernanceWorkflow',
    });

    const governanceResult = await this.deps.governanceEngine.execute({
      context,
      candidate: evidencePackage.candidate,
      evidence: evidencePackage.evidence,
      evidenceStatus: evidencePackage.status,
      validation: evidencePackage.validation,
    });

    if (!governanceResult.success || !governanceResult.data) {
      throw new Error(governanceResult.error?.reason ?? 'Governance evaluation failed');
    }

    logger.info('Governance workflow completed', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      durationMs: Date.now() - start,
      status: governanceResult.data.status,
    });

    return {
      workflowId: evidencePackage.workflowId,
      candidate: evidencePackage.candidate,
      evidence: evidencePackage.evidence,
      evidenceStatus: evidencePackage.status,
      validation: evidencePackage.validation,
      governance: governanceResult.data,
      readiness: governanceResult.data.readiness,
      completedAt: new Date().toISOString(),
    };
  }

  async runFinancialWorkflow(
    request: RunFinancialWorkflowRequest
  ): Promise<FinancialWorkflowResult> {
    const start = Date.now();
    const governanceResult = await this.runGovernanceWorkflow(request);

    const context: OptimizationContext = {
      workflowId: governanceResult.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: governanceResult.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: governanceResult.candidate,
    };

    logger.info('Starting financial workflow', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      operation: 'runFinancialWorkflow',
    });

    const financialResult = await this.deps.financialEngine.execute({
      context,
      candidate: governanceResult.candidate,
      evidence: governanceResult.evidence,
      governance: governanceResult.governance,
    });

    if (!financialResult.success || !financialResult.data) {
      throw new Error(financialResult.error?.reason ?? 'Financial calculation failed');
    }

    logger.info('Financial workflow completed', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      durationMs: Date.now() - start,
      status: financialResult.data.status,
    });

    return {
      workflowId: governanceResult.workflowId,
      candidate: governanceResult.candidate,
      evidence: governanceResult.evidence,
      evidenceStatus: governanceResult.evidenceStatus,
      validation: governanceResult.validation,
      governance: governanceResult.governance,
      readiness: governanceResult.readiness,
      financialImpact: financialResult.data,
      completedAt: new Date().toISOString(),
    };
  }

  async runRecommendationWorkflow(
    request: RunRecommendationWorkflowRequest
  ): Promise<RecommendationWorkflowResult> {
    const start = Date.now();
    const financialResult = await this.runFinancialWorkflow(request);

    const context: OptimizationContext = {
      workflowId: financialResult.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: financialResult.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: financialResult.candidate,
    };

    logger.info('Starting recommendation workflow', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      operation: 'runRecommendationWorkflow',
    });

    const confidenceResult = await this.deps.confidenceEngine.execute({
      context,
      candidate: financialResult.candidate,
      evidence: financialResult.evidence,
      evidenceStatus: financialResult.evidenceStatus,
      validation: financialResult.validation,
      governance: financialResult.governance,
      financialImpact: financialResult.financialImpact,
    });

    if (!confidenceResult.success || !confidenceResult.data) {
      throw new Error(confidenceResult.error?.reason ?? 'Confidence calculation failed');
    }

    const recommendationResult = await this.deps.recommendationEngine.execute({
      context,
      candidate: financialResult.candidate,
      evidence: financialResult.evidence,
      governance: financialResult.governance,
      financialImpact: financialResult.financialImpact,
      confidence: confidenceResult.data,
    });

    if (!recommendationResult.success || !recommendationResult.data) {
      throw new Error(recommendationResult.error?.reason ?? 'Recommendation generation failed');
    }

    logger.info('Recommendation workflow completed', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      durationMs: Date.now() - start,
      status: recommendationResult.data.status,
    });

    return {
      workflowId: financialResult.workflowId,
      candidate: financialResult.candidate,
      evidence: financialResult.evidence,
      evidenceStatus: financialResult.evidenceStatus,
      validation: financialResult.validation,
      governance: financialResult.governance,
      readiness: financialResult.readiness,
      financialImpact: financialResult.financialImpact,
      confidence: confidenceResult.data,
      recommendation: recommendationResult.data,
      completedAt: new Date().toISOString(),
    };
  }

  async runDemoWorkflow(request: RunWorkflowRequest): Promise<WorkflowResult> {
    const recommendationWorkflow = await this.runRecommendationWorkflow(request);
    const legacyEvidence = {
      resourceId: recommendationWorkflow.candidate.resourceId,
      resourceType: recommendationWorkflow.candidate.resourceType,
      region: recommendationWorkflow.candidate.region,
      status: recommendationWorkflow.evidenceStatus,
      cpuUtilization: recommendationWorkflow.evidence.telemetry.cpuUtilization,
      memoryUtilization: recommendationWorkflow.evidence.telemetry.memoryUtilization,
      networkUtilization: recommendationWorkflow.evidence.telemetry.networkUtilization,
      monthlyCost: recommendationWorkflow.evidence.pricing.monthlyRate,
      instanceType: recommendationWorkflow.evidence.instance.instanceType,
      recommendedInstanceType: recommendationWorkflow.evidence.recommendations[0]?.target,
      tags: recommendationWorkflow.evidence.tags,
      collectedAt: recommendationWorkflow.evidence.collectedAt,
    };
    const plugin = this.deps.getPlugin(request.plugin);

    const qualification = await plugin.qualify(legacyEvidence);
    const recommendation =
      recommendationWorkflow.recommendation.action ??
      (await plugin.recommend(legacyEvidence));

    const context = {
      workflowId: recommendationWorkflow.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: recommendationWorkflow.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: recommendationWorkflow.candidate,
    };

    const verificationResult = await this.deps.verificationEngine.execute({
      context,
      recommendation,
      financialImpact: recommendationWorkflow.financialImpact,
    });
    if (!verificationResult.success || !verificationResult.data) {
      throw new Error(verificationResult.error?.reason ?? 'Verification failed');
    }

    return {
      workflowId: recommendationWorkflow.workflowId,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.VERIFICATION,
      context,
      candidate: recommendationWorkflow.candidate,
      evidence: legacyEvidence,
      qualification,
      readiness: recommendationWorkflow.readiness,
      confidence: recommendationWorkflow.confidence,
      recommendation,
      governance: recommendationWorkflow.governance,
      financialImpact: recommendationWorkflow.financialImpact,
      recommendationDecision: recommendationWorkflow.recommendation,
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
