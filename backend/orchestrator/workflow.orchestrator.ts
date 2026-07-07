import type { OptimizationPlugin } from '../shared/interfaces';
import type {
  EvidenceEngineInterface,
  FinancialEngineInterface,
  GovernanceEngineInterface,
  VerificationEngineInterface,
} from '../shared/interfaces';
import type { OptimizationContext, WorkflowResult } from '../shared/types';
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
  governanceEngine: GovernanceEngineInterface;
  financialEngine: FinancialEngineInterface;
  verificationEngine: VerificationEngineInterface;
  getPlugin: (name: PluginName) => OptimizationPlugin;
}

export interface RunWorkflowRequest {
  plugin: PluginName;
  resourceId?: string;
}

/**
 * Workflow Orchestrator — coordinates engines and plugins through the optimization lifecycle.
 * Contains no optimization logic. Does not execute AWS actions.
 */
export class WorkflowOrchestrator {
  constructor(private readonly deps: WorkflowOrchestratorDependencies) {}

  async runDemoWorkflow(request: RunWorkflowRequest): Promise<WorkflowResult> {
    const workflowId = generateWorkflowId();
    const start = Date.now();

    const context: OptimizationContext = {
      workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: 'us-east-1',
      mode: PLATFORM_MODE.DEMO,
      startedAt: new Date().toISOString(),
    };

    logger.info('Starting workflow', {
      workflowId,
      plugin: request.plugin,
      operation: 'runDemoWorkflow',
    });

    const plugin = this.deps.getPlugin(request.plugin);

    const candidates = await plugin.collectCandidates();
    const candidate =
      candidates.find((c) => c.resourceId === request.resourceId) ?? candidates[0];

    if (!candidate) {
      throw new Error('No optimization candidates found');
    }

    context.candidate = candidate;

    const evidenceResult = await this.deps.evidenceEngine.execute({ context, candidate });
    if (!evidenceResult.success || !evidenceResult.data) {
      throw new Error(evidenceResult.error?.reason ?? 'Evidence collection failed');
    }

    const pluginEvidence = await plugin.collectEvidence(candidate);
    const qualification = await plugin.qualify(pluginEvidence);
    const readiness = await plugin.scoreReadiness(pluginEvidence);
    const confidence = await plugin.scoreConfidence(pluginEvidence);
    const recommendation = await plugin.recommend(pluginEvidence);

    const governanceResult = await this.deps.governanceEngine.execute({
      context,
      evidence: evidenceResult.data.evidence,
      recommendation,
    });
    if (!governanceResult.success || !governanceResult.data) {
      throw new Error(governanceResult.error?.reason ?? 'Governance evaluation failed');
    }

    const financialResult = await this.deps.financialEngine.execute({
      context,
      evidence: evidenceResult.data.evidence,
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

    const result: WorkflowResult = {
      workflowId,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.VERIFICATION,
      context,
      candidate,
      evidence: pluginEvidence,
      qualification,
      readiness,
      confidence,
      recommendation,
      governance: governanceResult.data,
      financialImpact: pluginFinancial,
      verification: verificationResult.data,
      completedAt: new Date().toISOString(),
    };

    logger.info('Workflow completed', {
      workflowId,
      plugin: request.plugin,
      durationMs: Date.now() - start,
      status: WORKFLOW_STATES.COMPLETED,
    });

    return result;
  }
}

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies
): WorkflowOrchestrator {
  return new WorkflowOrchestrator(deps);
}
