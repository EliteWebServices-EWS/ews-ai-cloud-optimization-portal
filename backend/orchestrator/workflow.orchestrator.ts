import type { OptimizationPlugin, EvidenceEngineInterface } from '../shared/interfaces';
import type {
  CompleteWorkflowResult,
  EvidencePackage,
  FinancialWorkflowResult,
  GovernanceWorkflowResult,
  OptimizationContext,
  OptimizationOutcome,
  RecommendationWorkflowResult,
  VerificationWorkflowResult,
  WorkflowResult,
} from '../shared/types';
import type { ExecutionSimulatorInterface } from '../execution';
import type { LearningStoreInterface } from '../engines/learning';
import type { VerificationEngine } from '../engines/verification';
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
  verificationEngine: VerificationEngine;
  executionSimulator: ExecutionSimulatorInterface;
  learningStore: LearningStoreInterface;
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

export interface RunVerificationWorkflowRequest extends RunWorkflowRequest {}

export interface RunCompleteWorkflowRequest extends RunWorkflowRequest {}

/**
 * Workflow Orchestrator — coordinates engines and plugins through the optimization lifecycle.
 * Sprint 6: closed-loop workflow with mock execution and verification.
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

  async runVerificationWorkflow(
    request: RunVerificationWorkflowRequest
  ): Promise<VerificationWorkflowResult> {
    const start = Date.now();
    const recommendationWorkflow = await this.runRecommendationWorkflow(request);
    const plugin = this.deps.getPlugin(request.plugin);

    const context: OptimizationContext = {
      workflowId: recommendationWorkflow.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: recommendationWorkflow.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: recommendationWorkflow.candidate,
    };

    logger.info('Starting verification workflow', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      operation: 'runVerificationWorkflow',
    });

    const executionResult = await this.deps.executionSimulator.simulate({
      context,
      candidate: recommendationWorkflow.candidate,
      recommendation: recommendationWorkflow.recommendation,
    });

    const recommendationAction =
      recommendationWorkflow.recommendation.action ??
      ({
        action: recommendationWorkflow.recommendation.detail.action,
        resourceId: recommendationWorkflow.candidate.resourceId,
        resourceType: recommendationWorkflow.candidate.resourceType,
        from: recommendationWorkflow.recommendation.detail.fromInstanceType,
        to: recommendationWorkflow.recommendation.detail.toInstanceType,
        reason: recommendationWorkflow.recommendation.reason,
        region: recommendationWorkflow.candidate.region,
      } as import('../shared/types').Recommendation);

    const observation = await plugin.verify({
      executionResult,
      recommendation: recommendationAction,
      financialImpact: recommendationWorkflow.financialImpact,
    });

    logger.info('Observation collected', {
      workflowId: context.workflowId,
      operation: 'runVerificationWorkflow',
      executionId: executionResult.executionId,
    });

    const verificationResult = await this.deps.verificationEngine.execute({
      context,
      recommendation: recommendationWorkflow.recommendation,
      financialImpact: recommendationWorkflow.financialImpact,
      executionResult,
      observation,
    });

    if (!verificationResult.success || !verificationResult.data) {
      throw new Error(verificationResult.error?.reason ?? 'Verification failed');
    }

    const report = this.deps.verificationEngine.buildReport(
      {
        context,
        recommendation: recommendationWorkflow.recommendation,
        financialImpact: recommendationWorkflow.financialImpact,
        executionResult,
        observation,
      },
      verificationResult.data
    );

    const outcome: OptimizationOutcome = {
      workflowId: recommendationWorkflow.workflowId,
      plugin: request.plugin,
      candidate: recommendationWorkflow.candidate,
      recommendation: recommendationWorkflow.recommendation,
      execution: executionResult,
      observation,
      verification: verificationResult.data,
      financialImpact: recommendationWorkflow.financialImpact,
      completedAt: new Date().toISOString(),
    };

    const learningRecord = this.deps.learningStore.save(
      this.deps.learningStore.buildRecord(outcome)
    );

    logger.info('Verification workflow completed', {
      workflowId: context.workflowId,
      plugin: request.plugin,
      durationMs: Date.now() - start,
      status: verificationResult.data.status,
    });

    return {
      ...recommendationWorkflow,
      execution: executionResult,
      observation,
      verification: verificationResult.data,
      report,
      learningRecord,
      completedAt: new Date().toISOString(),
    };
  }

  async runCompleteWorkflow(
    request: RunCompleteWorkflowRequest
  ): Promise<CompleteWorkflowResult> {
    const verificationWorkflow = await this.runVerificationWorkflow(request);

    return {
      ...verificationWorkflow,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.LEARNING,
    };
  }

  async runDemoWorkflow(request: RunWorkflowRequest): Promise<WorkflowResult> {
    const completeWorkflow = await this.runCompleteWorkflow(request);
    const legacyEvidence = {
      resourceId: completeWorkflow.candidate.resourceId,
      resourceType: completeWorkflow.candidate.resourceType,
      region: completeWorkflow.candidate.region,
      status: completeWorkflow.evidenceStatus,
      cpuUtilization: completeWorkflow.evidence.telemetry.cpuUtilization,
      memoryUtilization: completeWorkflow.evidence.telemetry.memoryUtilization,
      networkUtilization: completeWorkflow.evidence.telemetry.networkUtilization,
      monthlyCost: completeWorkflow.evidence.pricing.monthlyRate,
      instanceType: completeWorkflow.evidence.instance.instanceType,
      recommendedInstanceType: completeWorkflow.evidence.recommendations[0]?.target,
      tags: completeWorkflow.evidence.tags,
      collectedAt: completeWorkflow.evidence.collectedAt,
    };
    const plugin = this.deps.getPlugin(request.plugin);

    const qualification = await plugin.qualify(legacyEvidence);
    const recommendation =
      completeWorkflow.recommendation.action ??
      ({
        action: completeWorkflow.recommendation.detail.action,
        resourceId: completeWorkflow.candidate.resourceId,
        resourceType: completeWorkflow.candidate.resourceType,
        from: completeWorkflow.recommendation.detail.fromInstanceType,
        to: completeWorkflow.recommendation.detail.toInstanceType,
        reason: completeWorkflow.recommendation.reason,
        region: completeWorkflow.candidate.region,
      } as import('../shared/types').Recommendation);

    const context: OptimizationContext = {
      workflowId: completeWorkflow.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: completeWorkflow.candidate.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
      candidate: completeWorkflow.candidate,
    };

    return {
      workflowId: completeWorkflow.workflowId,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.VERIFICATION,
      context,
      candidate: completeWorkflow.candidate,
      evidence: legacyEvidence,
      qualification,
      readiness: completeWorkflow.readiness,
      confidence: completeWorkflow.confidence,
      recommendation,
      governance: completeWorkflow.governance,
      financialImpact: completeWorkflow.financialImpact,
      execution: completeWorkflow.execution,
      observation: completeWorkflow.observation,
      recommendationDecision: completeWorkflow.recommendation,
      verification: completeWorkflow.verification,
      verificationReport: completeWorkflow.report,
      learningRecord: completeWorkflow.learningRecord,
      completedAt: new Date().toISOString(),
    };
  }
}

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies
): WorkflowOrchestrator {
  return new WorkflowOrchestrator(deps);
}
