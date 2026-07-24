import type { OptimizationPlugin, EvidenceEngineInterface } from '../shared/interfaces';
import type {
  CompleteWorkflowResult,
  EvidencePackage,
  FinancialWorkflowResult,
  GovernanceWorkflowResult,
  OptimizationContext,
  OptimizationOutcome,
  Recommendation,
  RecommendationWorkflowResult,
  VerificationWorkflowResult,
  WorkflowResult,
} from '../shared/types';
import type { ExecutionSimulatorInterface } from '../execution';
import { buildLearningRecord, type LearningStoreInterface } from '../engines/learning';
import type { VerificationEngine } from '../engines/verification';
import {
  PLATFORM_MODE,
  PROVIDER_NAMES,
  WORKFLOW_EXECUTION_STATES,
  WORKFLOW_STAGES,
  WORKFLOW_STATES,
  type PluginName,
} from '../shared/constants';
import { createLogger, deriveIdempotentWorkflowId, generateWorkflowId } from '../shared/utils';
import { RepositoryAlreadyExistsError } from '../database';
import { resolveWorkflowConfig, type WorkflowConfig } from './workflow.config';
import { WorkflowStageError, toEngineError } from './workflow.errors';
import { createRetryState, recordFailedAttempt } from './workflow.retry';
import { createWorkflowStore, type WorkflowStoreInterface } from './workflow.store';
import type { WorkflowListQuery } from './workflow.query';
import type {
  ExecuteWorkflowRequest,
  HardenedWorkflowResult,
  WorkflowContext,
  WorkflowFailure,
  WorkflowMetadata,
  WorkflowRecord,
} from './workflow.types';
import {
  STAGE_EXECUTION_STATE,
  validateConfidenceStage,
  validateEvidenceStage,
  validateExecutionStage,
  validateFinancialStage,
  validateGovernanceStage,
  validateLearningStage,
  validateRecommendationStage,
  validateStageEnabled,
  validateVerificationStage,
} from './workflow.validator';

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
  workflowStore?: WorkflowStoreInterface;
  workflowConfig?: WorkflowConfig;
}

export interface RunWorkflowRequest {
  tenantId: string;
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
 * Workflow Orchestrator — production-ready workflow engine coordinating engines and plugins.
 * Sprint 7: explicit states, context, failure management, retry structure, and tracking.
 */
export class WorkflowOrchestrator {
  private readonly store: WorkflowStoreInterface;
  private readonly defaultConfig: WorkflowConfig;

  constructor(private readonly deps: WorkflowOrchestratorDependencies) {
    this.store = deps.workflowStore ?? createWorkflowStore();
    this.defaultConfig = deps.workflowConfig ?? resolveWorkflowConfig('full');
  }

  /** Start and execute a full optimization workflow with tracking. */
  async executeWorkflow(request: ExecuteWorkflowRequest): Promise<HardenedWorkflowResult> {
    const config = resolveWorkflowConfig(request.mode);
    const region = request.region ?? 'us-east-1';
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    // Idempotent execution (Task 4): a client-supplied idempotency key always
    // derives the same workflowId for this tenant, so a retried/duplicated
    // request naturally lands on the same DynamoDB item instead of creating
    // a new workflow.
    const workflowId = request.idempotencyKey
      ? deriveIdempotentWorkflowId(request.tenantId, request.idempotencyKey)
      : generateWorkflowId();

    if (request.idempotencyKey) {
      const existing = await this.store.get(request.tenantId, workflowId);
      if (existing) {
        logger.info('Duplicate workflow request replayed via idempotency key', {
          workflowId,
          operation: 'executeWorkflow',
        });
        return this.toReplayResult(existing, startMs);
      }
    }

    const context = this.createInitialContext({
      workflowId,
      tenantId: request.tenantId,
      plugin: request.plugin,
      region,
      triggerSource: request.triggerSource ?? 'api',
      startedAt,
      config,
    });

    const metadata: WorkflowMetadata = {
      workflowId,
      tenantId: request.tenantId,
      ownerId: request.ownerId,
      plugin: request.plugin,
      createdAt: startedAt,
      updatedAt: startedAt,
      status: WORKFLOW_STATES.PENDING,
      executionState: WORKFLOW_EXECUTION_STATES.INITIALIZED,
      triggerSource: request.triggerSource ?? 'api',
      resourceId: request.resourceId,
      region,
      idempotencyKey: request.idempotencyKey,
    };

    const record: WorkflowRecord = { metadata, context };

    try {
      // Lifecycle step 1/4 (Task 3): PENDING is durably persisted before any
      // work begins. If the Lambda dies right after this write, the record
      // still exists on the next cold start.
      await this.store.save(record);
    } catch (error) {
      if (error instanceof RepositoryAlreadyExistsError) {
        // Task 5: another concurrent invocation won the create race for this
        // workflowId (only possible when idempotencyKey collides, since
        // generateWorkflowId() is otherwise unique per call). No duplicate
        // workflow is created — replay whatever the winner produced/is doing.
        const winner = await this.store.get(request.tenantId, workflowId);
        if (winner) {
          logger.info('Concurrent duplicate workflow creation avoided', {
            workflowId,
            operation: 'executeWorkflow',
          });
          return this.toReplayResult(winner, startMs);
        }
      }
      throw error;
    }

    logger.info('Workflow created', {
      workflowId,
      plugin: request.plugin,
      operation: 'executeWorkflow',
      status: WORKFLOW_STATES.PENDING,
    });

    // Lifecycle step 2/4: PENDING -> RUNNING.
    context.status = WORKFLOW_STATES.RUNNING;
    await this.store.updateContext(request.tenantId, workflowId, context);

    logger.info('Workflow started', {
      workflowId,
      plugin: request.plugin,
      stage: WORKFLOW_STAGES.EVIDENCE,
      operation: 'executeWorkflow',
      status: WORKFLOW_STATES.RUNNING,
    });

    try {
      const plugin = this.deps.getPlugin(request.plugin);
      const candidates = await plugin.collectCandidates();
      const candidate =
        candidates.find((item) => item.resourceId === request.resourceId) ?? candidates[0];

      if (!candidate) {
        return await this.failWorkflow(context, config, WORKFLOW_STAGES.EVIDENCE, {
          engine: 'Workflow Orchestrator',
          code: 'NO_CANDIDATES',
          reason: 'No optimization candidates found',
        }, startMs);
      }

      context.candidate = candidate;
      await this.store.updateContext(request.tenantId, workflowId, context);

      await this.runPipeline(context, config, plugin);

      const durationMs = Date.now() - startMs;
      context.completedAt = new Date().toISOString();
      context.durationMs = durationMs;
      context.status = WORKFLOW_STATES.COMPLETED;
      context.executionState = WORKFLOW_EXECUTION_STATES.COMPLETED;

      // Lifecycle step 4/4: RUNNING -> COMPLETED.
      const result = this.buildWorkflowResult(context, durationMs);
      await this.store.updateContext(request.tenantId, workflowId, context);
      await this.store.updateResult(request.tenantId, workflowId, result);

      logger.info('Workflow completed', {
        workflowId,
        plugin: request.plugin,
        stage: context.currentStage,
        operation: 'executeWorkflow',
        durationMs,
        status: WORKFLOW_STATES.COMPLETED,
      });

      return result;
    } catch (error) {
      if (error instanceof WorkflowStageError) {
        return this.failWorkflow(
          context,
          config,
          error.failedStage,
          error.engineError,
          startMs
        );
      }
      const engineError = toEngineError(error, 'Workflow Orchestrator');
      return this.failWorkflow(
        context,
        config,
        context.currentStage ?? WORKFLOW_STAGES.EVIDENCE,
        engineError,
        startMs
      );
    }
  }

  /** Build a HardenedWorkflowResult from an existing record for idempotent
   * replay, instead of re-running the workflow (Task 4/5). */
  private toReplayResult(record: WorkflowRecord, startMs: number): HardenedWorkflowResult {
    if (record.result) {
      return { ...record.result, duplicate: true };
    }

    // The original request is still PENDING/RUNNING — report its current
    // state rather than fabricating a completed result.
    return {
      ...this.buildWorkflowResult(record.context, Date.now() - startMs),
      duplicate: true,
    };
  }

  /** Retrieve a tracked workflow by tenant and ID. */
  async getWorkflow(tenantId: string, workflowId: string): Promise<WorkflowRecord | undefined> {
    return this.store.get(tenantId, workflowId);
  }

  /** Resolve the owning tenant for a workflow ID without exposing the record. */
  async resolveWorkflowOwnerTenantId(workflowId: string): Promise<string | undefined> {
    return this.store.resolveOwnerTenantId(workflowId);
  }

  /** List workflows for a tenant with cursor pagination. */
  async listWorkflows(
    tenantId: string,
    query: WorkflowListQuery
  ): Promise<{ items: WorkflowMetadata[]; nextToken?: string }> {
    return this.store.listPage(tenantId, {
      limit: query.limit,
      nextToken: query.nextToken,
      status: query.status,
    });
  }

  /** Retrieve workflow status summary by tenant and ID. */
  async getWorkflowStatus(tenantId: string, workflowId: string): Promise<{
    metadata: WorkflowMetadata;
    completedStages: string[];
    failedStages: string[];
    currentStage?: string;
    failure?: WorkflowFailure;
  } | undefined> {
    const record = await this.store.get(tenantId, workflowId);
    if (!record) {
      return undefined;
    }
    return {
      metadata: record.metadata,
      completedStages: record.context.completedStages,
      failedStages: record.context.failedStages,
      currentStage: record.context.currentStage,
      failure: record.context.failure,
    };
  }

  async runEvidenceWorkflow(request: RunEvidenceWorkflowRequest): Promise<EvidencePackage> {
    const context = await this.runPartialWorkflow(request, [WORKFLOW_STAGES.EVIDENCE]);
    if (!context.evidence || !context.candidate || !context.evidenceStatus || !context.validation) {
      throw new Error('Evidence collection did not produce expected output');
    }
    return {
      workflowId: context.workflowId,
      candidate: context.candidate,
      evidence: context.evidence,
      status: context.evidenceStatus,
      validation: context.validation,
    };
  }

  async runGovernanceWorkflow(
    request: RunGovernanceWorkflowRequest
  ): Promise<GovernanceWorkflowResult> {
    const context = await this.runPartialWorkflow(request, [
      WORKFLOW_STAGES.EVIDENCE,
      WORKFLOW_STAGES.GOVERNANCE,
    ]);
    this.assertStageOutputs(context, WORKFLOW_STAGES.GOVERNANCE);
    return this.toGovernanceResult(context);
  }

  async runFinancialWorkflow(
    request: RunFinancialWorkflowRequest
  ): Promise<FinancialWorkflowResult> {
    const context = await this.runPartialWorkflow(request, [
      WORKFLOW_STAGES.EVIDENCE,
      WORKFLOW_STAGES.GOVERNANCE,
      WORKFLOW_STAGES.FINANCIAL,
    ]);
    this.assertStageOutputs(context, WORKFLOW_STAGES.FINANCIAL);
    return this.toFinancialResult(context);
  }

  async runRecommendationWorkflow(
    request: RunRecommendationWorkflowRequest
  ): Promise<RecommendationWorkflowResult> {
    const context = await this.runPartialWorkflow(request, [
      WORKFLOW_STAGES.EVIDENCE,
      WORKFLOW_STAGES.GOVERNANCE,
      WORKFLOW_STAGES.FINANCIAL,
      WORKFLOW_STAGES.CONFIDENCE,
      WORKFLOW_STAGES.RECOMMENDATION,
    ]);
    this.assertStageOutputs(context, WORKFLOW_STAGES.RECOMMENDATION);
    return this.toRecommendationResult(context);
  }

  async runVerificationWorkflow(
    request: RunVerificationWorkflowRequest
  ): Promise<VerificationWorkflowResult> {
    const context = await this.runPartialWorkflow(request, [
      WORKFLOW_STAGES.EVIDENCE,
      WORKFLOW_STAGES.GOVERNANCE,
      WORKFLOW_STAGES.FINANCIAL,
      WORKFLOW_STAGES.CONFIDENCE,
      WORKFLOW_STAGES.RECOMMENDATION,
      WORKFLOW_STAGES.EXECUTION,
      WORKFLOW_STAGES.VERIFICATION,
      WORKFLOW_STAGES.LEARNING,
    ]);
    this.assertStageOutputs(context, WORKFLOW_STAGES.VERIFICATION);
    return this.toVerificationResult(context);
  }

  async runCompleteWorkflow(
    request: RunCompleteWorkflowRequest
  ): Promise<CompleteWorkflowResult> {
    const result = await this.executeWorkflow({ ...request, mode: 'full', triggerSource: 'api' });
    const verification = await this.toVerificationResultFromHardened(
      result,
      request.tenantId
    );
    return {
      ...verification,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.LEARNING,
    };
  }

  async runDemoWorkflow(request: RunWorkflowRequest): Promise<WorkflowResult> {
    const hardened = await this.executeWorkflow({ ...request, mode: 'full', triggerSource: 'api' });
    const record = await this.store.get(request.tenantId, hardened.workflowId);
    if (!record) {
      throw new Error(`Workflow record not found: ${hardened.workflowId}`);
    }
    const context = record.context;
    const plugin = this.deps.getPlugin(request.plugin);

    const legacyEvidence = {
      resourceId: context.candidate!.resourceId,
      resourceType: context.candidate!.resourceType,
      region: context.candidate!.region,
      status: context.evidenceStatus!,
      cpuUtilization: context.evidence!.telemetry.cpuUtilization,
      memoryUtilization: context.evidence!.telemetry.memoryUtilization,
      networkUtilization: context.evidence!.telemetry.networkUtilization,
      monthlyCost: context.evidence!.pricing.monthlyRate,
      instanceType: context.evidence!.instance.instanceType,
      recommendedInstanceType: context.evidence!.recommendations[0]?.target,
      tags: context.evidence!.tags,
      collectedAt: context.evidence!.collectedAt,
    };

    const qualification = await plugin.qualify(legacyEvidence);
    const recommendation = this.toLegacyRecommendation(context);

    const optimizationContext: OptimizationContext = {
      tenantId: context.tenantId,
      workflowId: context.workflowId,
      plugin: request.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: context.candidate!.region,
      mode: PLATFORM_MODE.DEMO,
      startedAt: context.startedAt,
      candidate: context.candidate,
    };

    return {
      workflowId: context.workflowId,
      status: WORKFLOW_STATES.COMPLETED,
      currentStage: WORKFLOW_STAGES.VERIFICATION,
      context: optimizationContext,
      candidate: context.candidate!,
      evidence: legacyEvidence,
      qualification,
      readiness: context.readiness!,
      confidence: context.confidence!,
      recommendation,
      governance: context.governance!,
      financialImpact: context.financialImpact!,
      execution: context.execution,
      observation: context.observation,
      verification: context.verification!,
      completedAt: context.completedAt ?? new Date().toISOString(),
      recommendationDecision: context.recommendation,
      verificationReport: context.report,
      learningRecord: context.learningRecord,
    };
  }

  private createInitialContext(params: {
    workflowId: string;
    tenantId: string;
    plugin: PluginName;
    region: string;
    triggerSource: WorkflowContext['triggerSource'];
    startedAt: string;
    config: WorkflowConfig;
  }): WorkflowContext {
    return {
      workflowId: params.workflowId,
      tenantId: params.tenantId,
      plugin: params.plugin,
      provider: PROVIDER_NAMES.MOCK,
      region: params.region,
      mode: PLATFORM_MODE.DEMO,
      triggerSource: params.triggerSource,
      startedAt: params.startedAt,
      status: WORKFLOW_STATES.RUNNING,
      executionState: WORKFLOW_EXECUTION_STATES.INITIALIZED,
      completedStages: [],
      failedStages: [],
      retry: createRetryState(params.config.maxRetries),
    };
  }

  private async runPartialWorkflow(
    request: RunWorkflowRequest,
    stages: import('../shared/constants').WorkflowStage[]
  ): Promise<WorkflowContext> {
    const config = this.defaultConfig;
    const workflowId = generateWorkflowId();
    const region = request.region ?? 'us-east-1';
    const startedAt = new Date().toISOString();

    const context = this.createInitialContext({
      workflowId,
      tenantId: request.tenantId,
      plugin: request.plugin,
      region,
      triggerSource: 'api',
      startedAt,
      config,
    });

    const plugin = this.deps.getPlugin(request.plugin);
    const candidates = await plugin.collectCandidates();
    const candidate =
      candidates.find((item) => item.resourceId === request.resourceId) ?? candidates[0];

    if (!candidate) {
      throw new Error('No optimization candidates found');
    }

    context.candidate = candidate;

    for (const stage of stages) {
      await this.executeStage(context, config, plugin, stage);
    }

    return context;
  }

  private async runPipeline(
    context: WorkflowContext,
    config: WorkflowConfig,
    plugin: OptimizationPlugin
  ): Promise<void> {
    const pipeline: import('../shared/constants').WorkflowStage[] = [
      WORKFLOW_STAGES.EVIDENCE,
      WORKFLOW_STAGES.GOVERNANCE,
      WORKFLOW_STAGES.FINANCIAL,
      WORKFLOW_STAGES.CONFIDENCE,
      WORKFLOW_STAGES.RECOMMENDATION,
    ];

    if (config.featureFlags.enableExecution) {
      pipeline.push(WORKFLOW_STAGES.EXECUTION, WORKFLOW_STAGES.VERIFICATION);
    }
    if (config.featureFlags.enableLearning) {
      pipeline.push(WORKFLOW_STAGES.LEARNING);
    }

    for (const stage of pipeline) {
      await this.executeStage(context, config, plugin, stage);
      await this.store.updateContext(context.tenantId, context.workflowId, context);
    }
  }

  private async executeStage(
    context: WorkflowContext,
    config: WorkflowConfig,
    plugin: OptimizationPlugin,
    stage: import('../shared/constants').WorkflowStage
  ): Promise<void> {
    validateStageEnabled(config, stage);
    context.currentStage = stage;
    context.executionState = STAGE_EXECUTION_STATE[stage];

    logger.info('Stage started', {
      workflowId: context.workflowId,
      plugin: context.plugin,
      stage,
      operation: 'executeStage',
      status: WORKFLOW_STATES.RUNNING,
    });

    const stageStart = Date.now();

    try {
      switch (stage) {
        case WORKFLOW_STAGES.EVIDENCE:
          await this.collectEvidence(context, plugin);
          break;
        case WORKFLOW_STAGES.GOVERNANCE:
          await this.evaluateGovernance(context);
          break;
        case WORKFLOW_STAGES.FINANCIAL:
          await this.calculateFinancialImpact(context);
          break;
        case WORKFLOW_STAGES.CONFIDENCE:
          await this.calculateConfidence(context);
          break;
        case WORKFLOW_STAGES.RECOMMENDATION:
          await this.generateRecommendation(context);
          break;
        case WORKFLOW_STAGES.EXECUTION:
          await this.simulateExecution(context, plugin);
          break;
        case WORKFLOW_STAGES.VERIFICATION:
          await this.verifyOutcome(context, plugin);
          break;
        case WORKFLOW_STAGES.LEARNING:
          await this.storeOutcome(context);
          break;
        default:
          break;
      }

      context.completedStages.push(stage);

      logger.info('Stage completed', {
        workflowId: context.workflowId,
        plugin: context.plugin,
        stage,
        operation: 'executeStage',
        durationMs: Date.now() - stageStart,
        status: 'completed',
      });
    } catch (error) {
      const engineError = error instanceof WorkflowStageError
        ? error.engineError
        : toEngineError(error, 'Workflow Orchestrator');

      throw error instanceof WorkflowStageError
        ? error
        : new WorkflowStageError(stage, context.executionState, engineError);
    }
  }

  private async collectEvidence(
    context: WorkflowContext,
    plugin: OptimizationPlugin
  ): Promise<void> {
    validateEvidenceStage(context);

    const optimizationContext = this.toOptimizationContext(context);
    const providerData = await plugin.collectProviderEvidence(context.candidate!);
    const evidenceResult = await this.deps.evidenceEngine.execute({
      context: optimizationContext,
      candidate: context.candidate!,
      providerData,
    });

    if (!evidenceResult.success || !evidenceResult.data) {
      throw new WorkflowStageError(
        WORKFLOW_STAGES.EVIDENCE,
        WORKFLOW_EXECUTION_STATES.EVIDENCE_COLLECTION,
        evidenceResult.error ?? {
          engine: 'Evidence Engine',
          code: 'EVIDENCE_FAILED',
          reason: 'Evidence collection failed',
        }
      );
    }

    context.evidence = evidenceResult.data.package.evidence;
    context.evidenceStatus = evidenceResult.data.status;
    context.validation = evidenceResult.data.package.validation;
  }

  private async evaluateGovernance(context: WorkflowContext): Promise<void> {
    validateGovernanceStage(context);

    const governanceResult = await this.deps.governanceEngine.execute({
      context: this.toOptimizationContext(context),
      candidate: context.candidate!,
      evidence: context.evidence!,
      evidenceStatus: context.evidenceStatus!,
      validation: context.validation!,
    });

    if (!governanceResult.success || !governanceResult.data) {
      throw new WorkflowStageError(
        WORKFLOW_STAGES.GOVERNANCE,
        WORKFLOW_EXECUTION_STATES.GOVERNANCE_EVALUATION,
        governanceResult.error ?? {
          engine: 'Governance Engine',
          code: 'GOVERNANCE_FAILED',
          reason: 'Governance evaluation failed',
        }
      );
    }

    context.governance = governanceResult.data;
    context.readiness = governanceResult.data.readiness;
  }

  private async calculateFinancialImpact(context: WorkflowContext): Promise<void> {
    validateFinancialStage(context);

    const financialResult = await this.deps.financialEngine.execute({
      context: this.toOptimizationContext(context),
      candidate: context.candidate!,
      evidence: context.evidence!,
      governance: context.governance!,
    });

    if (!financialResult.success || !financialResult.data) {
      throw new WorkflowStageError(
        WORKFLOW_STAGES.FINANCIAL,
        WORKFLOW_EXECUTION_STATES.FINANCIAL_ANALYSIS,
        financialResult.error ?? {
          engine: 'Financial Engine',
          code: 'FINANCIAL_FAILED',
          reason: 'Financial calculation failed',
        }
      );
    }

    context.financialImpact = financialResult.data;
  }

  private async calculateConfidence(context: WorkflowContext): Promise<void> {
    validateConfidenceStage(context);

    const confidenceResult = await this.deps.confidenceEngine.execute({
      context: this.toOptimizationContext(context),
      candidate: context.candidate!,
      evidence: context.evidence!,
      evidenceStatus: context.evidenceStatus!,
      validation: context.validation!,
      governance: context.governance!,
      financialImpact: context.financialImpact!,
    });

    if (!confidenceResult.success || !confidenceResult.data) {
      throw new WorkflowStageError(
        WORKFLOW_STAGES.CONFIDENCE,
        WORKFLOW_EXECUTION_STATES.CONFIDENCE_ANALYSIS,
        confidenceResult.error ?? {
          engine: 'Confidence Engine',
          code: 'CONFIDENCE_FAILED',
          reason: 'Confidence calculation failed',
        }
      );
    }

    context.confidence = confidenceResult.data;
  }

  private async generateRecommendation(context: WorkflowContext): Promise<void> {
    validateRecommendationStage(context);

    const recommendationResult = await this.deps.recommendationEngine.execute({
      context: this.toOptimizationContext(context),
      candidate: context.candidate!,
      evidence: context.evidence!,
      governance: context.governance!,
      financialImpact: context.financialImpact!,
      confidence: context.confidence!,
    });

    if (!recommendationResult.success || !recommendationResult.data) {
      throw new WorkflowStageError(
        WORKFLOW_STAGES.RECOMMENDATION,
        WORKFLOW_EXECUTION_STATES.RECOMMENDATION_GENERATION,
        recommendationResult.error ?? {
          engine: 'Recommendation Engine',
          code: 'RECOMMENDATION_FAILED',
          reason: 'Recommendation generation failed',
        }
      );
    }

    context.recommendation = recommendationResult.data;
  }

  private async simulateExecution(
    context: WorkflowContext,
    _plugin: OptimizationPlugin
  ): Promise<void> {
    validateExecutionStage(context);

    const executionResult = await this.deps.executionSimulator.simulate({
      context: this.toOptimizationContext(context),
      candidate: context.candidate!,
      recommendation: context.recommendation!,
    });

    context.execution = executionResult;
  }

  private async verifyOutcome(
    context: WorkflowContext,
    plugin: OptimizationPlugin
  ): Promise<void> {
    validateExecutionStage(context);

    const recommendationAction = this.toLegacyRecommendation(context);
    const observation = await plugin.verify({
      executionResult: context.execution!,
      recommendation: recommendationAction,
      financialImpact: context.financialImpact!,
    });

    context.observation = observation;

    validateVerificationStage(context);

    const verificationResult = await this.deps.verificationEngine.execute({
      context: this.toOptimizationContext(context),
      recommendation: context.recommendation!,
      financialImpact: context.financialImpact!,
      executionResult: context.execution!,
      observation,
    });

    if (!verificationResult.success || !verificationResult.data) {
      throw new WorkflowStageError(
        WORKFLOW_STAGES.VERIFICATION,
        WORKFLOW_EXECUTION_STATES.VERIFICATION,
        verificationResult.error ?? {
          engine: 'Verification Engine',
          code: 'VERIFICATION_FAILED',
          reason: 'Verification failed',
        }
      );
    }

    context.verification = verificationResult.data;
    context.report = this.deps.verificationEngine.buildReport(
      {
        context: this.toOptimizationContext(context),
        recommendation: context.recommendation!,
        financialImpact: context.financialImpact!,
        executionResult: context.execution!,
        observation,
      },
      verificationResult.data
    );
  }

  private async storeOutcome(context: WorkflowContext): Promise<void> {
    validateLearningStage(context);

    const outcome: OptimizationOutcome = {
      workflowId: context.workflowId,
      plugin: context.plugin,
      candidate: context.candidate!,
      recommendation: context.recommendation!,
      execution: context.execution!,
      observation: context.observation!,
      verification: context.verification!,
      financialImpact: context.financialImpact!,
      completedAt: new Date().toISOString(),
    };

    context.learningRecord = await this.deps.learningStore.save(
      buildLearningRecord(context.tenantId, {
        ...outcome,
        confidence: context.confidence,
      })
    );

    if (context.confidence) {
      await this.deps.learningStore.appendConfidence({
        historyId: `${context.workflowId}:confidence:1`,
        tenantId: context.tenantId,
        workflowId: context.workflowId,
        confidence: context.confidence,
        recordedAt: context.learningRecord.recordedAt,
      });
    }
  }

  private async failWorkflow(
    context: WorkflowContext,
    _config: WorkflowConfig,
    failedStage: import('../shared/constants').WorkflowStage,
    error: import('../shared/types').EngineError,
    startMs: number
  ): Promise<HardenedWorkflowResult> {
    const durationMs = Date.now() - startMs;
    const timestamp = new Date().toISOString();

    context.status = WORKFLOW_STATES.FAILED;
    context.executionState = WORKFLOW_EXECUTION_STATES.FAILED;
    context.failedStages.push(failedStage);
    context.completedAt = timestamp;
    context.durationMs = durationMs;
    context.failure = {
      workflowId: context.workflowId,
      failedStage,
      executionState: STAGE_EXECUTION_STATE[failedStage] ?? WORKFLOW_EXECUTION_STATES.FAILED,
      error,
      timestamp,
    };
    context.retry = recordFailedAttempt(
      context.retry,
      failedStage,
      context.executionState,
      error
    );

    const result = this.buildWorkflowResult(context, durationMs);
    await this.store.updateContext(context.tenantId, context.workflowId, context);
    await this.store.updateResult(context.tenantId, context.workflowId, result);

    logger.error('Stage failed', {
      workflowId: context.workflowId,
      plugin: context.plugin,
      stage: failedStage,
      operation: 'executeWorkflow',
      durationMs,
      status: WORKFLOW_STATES.FAILED,
    });

    logger.info('Workflow completed', {
      workflowId: context.workflowId,
      plugin: context.plugin,
      stage: failedStage,
      operation: 'executeWorkflow',
      durationMs,
      status: WORKFLOW_STATES.FAILED,
    });

    return result;
  }

  private buildWorkflowResult(context: WorkflowContext, durationMs: number): HardenedWorkflowResult {
    return {
      workflowId: context.workflowId,
      status: context.status,
      executionState: context.executionState,
      durationMs,
      candidate: context.candidate,
      recommendation: context.recommendation,
      financialImpact: context.financialImpact,
      verification: context.verification,
      report: context.report,
      learningRecord: context.learningRecord,
      completedStages: [...context.completedStages],
      failedStages: [...context.failedStages],
      failure: context.failure,
      retry: context.retry,
      completedAt: context.completedAt,
    };
  }

  private toOptimizationContext(context: WorkflowContext): OptimizationContext {
    return {
      tenantId: context.tenantId,
      workflowId: context.workflowId,
      plugin: context.plugin,
      provider: context.provider,
      region: context.region,
      mode: context.mode,
      startedAt: context.startedAt,
      candidate: context.candidate,
    };
  }

  private toLegacyRecommendation(context: WorkflowContext): Recommendation {
    return (
      context.recommendation?.action ??
      ({
        action: context.recommendation!.detail.action,
        resourceId: context.candidate!.resourceId,
        resourceType: context.candidate!.resourceType,
        from: context.recommendation!.detail.fromInstanceType,
        to: context.recommendation!.detail.toInstanceType,
        reason: context.recommendation!.reason,
        region: context.candidate!.region,
      } as Recommendation)
    );
  }

  private assertStageOutputs(
    context: WorkflowContext,
    stage: import('../shared/constants').WorkflowStage
  ): void {
    if (context.failedStages.length > 0 || context.status === WORKFLOW_STATES.FAILED) {
      const reason = context.failure?.error.reason ?? 'Workflow stage failed';
      throw new Error(reason);
    }
    if (!context.completedStages.includes(stage)) {
      throw new Error(`Stage ${stage} did not complete successfully`);
    }
  }

  private toGovernanceResult(context: WorkflowContext): GovernanceWorkflowResult {
    return {
      workflowId: context.workflowId,
      candidate: context.candidate!,
      evidence: context.evidence!,
      evidenceStatus: context.evidenceStatus!,
      validation: context.validation!,
      governance: context.governance!,
      readiness: context.readiness!,
      completedAt: new Date().toISOString(),
    };
  }

  private toFinancialResult(context: WorkflowContext): FinancialWorkflowResult {
    return {
      ...this.toGovernanceResult(context),
      financialImpact: context.financialImpact!,
    };
  }

  private toRecommendationResult(context: WorkflowContext): RecommendationWorkflowResult {
    return {
      ...this.toFinancialResult(context),
      confidence: context.confidence!,
      recommendation: context.recommendation!,
    };
  }

  private toVerificationResult(context: WorkflowContext): VerificationWorkflowResult {
    return {
      ...this.toRecommendationResult(context),
      execution: context.execution!,
      observation: context.observation!,
      verification: context.verification!,
      report: context.report!,
      learningRecord: context.learningRecord,
    };
  }

  private async toVerificationResultFromHardened(
    result: HardenedWorkflowResult,
    tenantId: string
  ): Promise<VerificationWorkflowResult> {
    const record = await this.store.get(tenantId, result.workflowId);
    if (!record) {
      throw new Error(`Workflow record not found: ${result.workflowId}`);
    }
    return this.toVerificationResult(record.context);
  }
}

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies
): WorkflowOrchestrator {
  return new WorkflowOrchestrator(deps);
}
