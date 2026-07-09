/**
 * Workflow Orchestrator integration tests.
 * Sprint 7: validates pipeline, failure handling, and lifecycle with mock provider.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createConfidenceEngine,
  createRecommendationEngine,
  createVerificationEngine,
  createLearningStore,
} from '../../engines';
import { createExecutionSimulator } from '../../execution';
import {
  createWorkflowOrchestrator,
  createWorkflowStore,
  type WorkflowOrchestratorDependencies,
} from '../../orchestrator';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { PLUGIN_NAMES, PROVIDER_NAMES, WORKFLOW_STATES, WORKFLOW_STAGES } from '../../shared/constants';
import type {
  ConfidenceRequest,
  ConfidenceResult,
  EvidenceRequest,
  EvidenceResult,
  FinancialRequest,
  FinancialImpact,
  GovernanceRequest,
  GovernanceResult,
  RecommendationRequest,
  RecommendationDecision,
  Result,
  VerificationResult,
} from '../../shared/types';

function buildOrchestrator(overrides: Partial<WorkflowOrchestratorDependencies> = {}) {
  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);
  const learningStore = createLearningStore();
  const executionSimulator = createExecutionSimulator();
  const workflowStore = createWorkflowStore();

  const base: WorkflowOrchestratorDependencies = {
    evidenceEngine: createEvidenceEngine(),
    governanceEngine: createGovernanceEngine(),
    financialEngine: createFinancialEngine({ provider }),
    confidenceEngine: createConfidenceEngine(),
    recommendationEngine: createRecommendationEngine(),
    verificationEngine: createVerificationEngine(),
    executionSimulator,
    learningStore,
    getPlugin: (name) => pluginRegistry.get(name),
    workflowStore,
  };

  return createWorkflowOrchestrator({ ...base, ...overrides });
}

function failingEngine<TInput, TOutput>(
  name: string,
  code: string,
  reason: string
): { execute: (input: TInput) => Promise<Result<TOutput>>; name: string } {
  return {
    name,
    async execute(): Promise<Result<TOutput>> {
      return {
        success: false,
        error: { engine: name, code, reason },
      };
    },
  };
}

describe('WorkflowOrchestrator', () => {
  let orchestrator: ReturnType<typeof buildOrchestrator>;

  beforeEach(() => {
    orchestrator = buildOrchestrator();
  });

  it('executes a successful full workflow lifecycle', async () => {
    const result = await orchestrator.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      triggerSource: 'api',
      mode: 'full',
    });

    assert.equal(result.status, WORKFLOW_STATES.COMPLETED);
    assert.ok(result.candidate);
    assert.ok(result.recommendation);
    assert.ok(result.financialImpact);
    assert.ok(result.verification);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.completedStages.includes(WORKFLOW_STAGES.EVIDENCE));
    assert.ok(result.completedStages.includes(WORKFLOW_STAGES.VERIFICATION));
    assert.equal(result.failedStages.length, 0);

    const record = orchestrator.getWorkflow(result.workflowId);
    assert.ok(record);
    assert.equal(record.metadata.status, WORKFLOW_STATES.COMPLETED);
  });

  it('tracks workflow status via getWorkflowStatus', async () => {
    const result = await orchestrator.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const status = orchestrator.getWorkflowStatus(result.workflowId);
    assert.ok(status);
    assert.equal(status.metadata.workflowId, result.workflowId);
    assert.equal(status.metadata.status, WORKFLOW_STATES.COMPLETED);
    assert.ok(status.completedStages.length > 0);
  });

  it('fails gracefully when evidence collection fails', async () => {
    const failing = buildOrchestrator({
      evidenceEngine: failingEngine<EvidenceRequest, EvidenceResult>(
        'Evidence Engine',
        'EVIDENCE_INCOMPLETE',
        'Missing utilization metrics'
      ),
    });

    const result = await failing.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.equal(result.status, WORKFLOW_STATES.FAILED);
    assert.ok(result.failure);
    assert.equal(result.failure.failedStage, WORKFLOW_STAGES.EVIDENCE);
    assert.equal(result.failure.error.code, 'EVIDENCE_INCOMPLETE');
    assert.ok(result.retry.failedAttempts.length > 0);
    assert.equal(result.retry.status, 'retryable');
  });

  it('fails gracefully when governance evaluation fails', async () => {
    const failing = buildOrchestrator({
      governanceEngine: failingEngine<GovernanceRequest, GovernanceResult>(
        'Governance Engine',
        'GOVERNANCE_BLOCKED',
        'Production workload requires approval'
      ),
    });

    const result = await failing.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.equal(result.status, WORKFLOW_STATES.FAILED);
    assert.equal(result.failure?.failedStage, WORKFLOW_STAGES.GOVERNANCE);
    assert.ok(result.completedStages.includes(WORKFLOW_STAGES.EVIDENCE));
    assert.ok(!result.completedStages.includes(WORKFLOW_STAGES.FINANCIAL));
  });

  it('fails gracefully when financial analysis fails', async () => {
    const failing = buildOrchestrator({
      financialEngine: failingEngine<FinancialRequest, FinancialImpact>(
        'Financial Engine',
        'FINANCIAL_FAILED',
        'Pricing data unavailable'
      ),
    });

    const result = await failing.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.equal(result.status, WORKFLOW_STATES.FAILED);
    assert.equal(result.failure?.failedStage, WORKFLOW_STAGES.FINANCIAL);
    assert.ok(result.completedStages.includes(WORKFLOW_STAGES.GOVERNANCE));
  });

  it('fails gracefully when recommendation generation fails', async () => {
    const failing = buildOrchestrator({
      recommendationEngine: failingEngine<RecommendationRequest, RecommendationDecision>(
        'Recommendation Engine',
        'RECOMMENDATION_FAILED',
        'Insufficient confidence for recommendation'
      ),
    });

    const result = await failing.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.equal(result.status, WORKFLOW_STATES.FAILED);
    assert.equal(result.failure?.failedStage, WORKFLOW_STAGES.RECOMMENDATION);
    assert.ok(result.completedStages.includes(WORKFLOW_STAGES.CONFIDENCE));
  });

  it('fails gracefully when verification fails', async () => {
    const baseVerification = createVerificationEngine();
    const failing = buildOrchestrator({
      verificationEngine: Object.assign(baseVerification, {
        async execute(): Promise<Result<VerificationResult>> {
          return {
            success: false,
            error: {
              engine: 'Verification Engine',
              code: 'VERIFICATION_FAILED',
              reason: 'Observed savings mismatch',
            },
          };
        },
      }),
    });

    const result = await failing.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.equal(result.status, WORKFLOW_STATES.FAILED);
    assert.equal(result.failure?.failedStage, WORKFLOW_STAGES.VERIFICATION);
    assert.ok(result.completedStages.includes(WORKFLOW_STAGES.EXECUTION));
  });

  it('supports dry-run mode without execution stages', async () => {
    const result = await orchestrator.executeWorkflow({
      plugin: PLUGIN_NAMES.EC2,
      mode: 'dry-run',
    });

    assert.equal(result.status, WORKFLOW_STATES.COMPLETED);
    assert.ok(result.recommendation);
    assert.equal(result.verification, undefined);
    assert.ok(!result.completedStages.includes(WORKFLOW_STAGES.EXECUTION));
    assert.ok(!result.completedStages.includes(WORKFLOW_STAGES.VERIFICATION));
  });
});

describe('Workflow retry structure', () => {
  it('records failed attempts up to max retries', async () => {
    const failing = buildOrchestrator({
      evidenceEngine: failingEngine<EvidenceRequest, EvidenceResult>(
        'Evidence Engine',
        'EVIDENCE_INCOMPLETE',
        'Missing metrics'
      ),
    });

    const result = await failing.executeWorkflow({ plugin: PLUGIN_NAMES.EC2, mode: 'full' });

    assert.equal(result.retry.maxRetries, 3);
    assert.equal(result.retry.attemptCount, 1);
    assert.equal(result.retry.status, 'retryable');
    assert.equal(result.retry.failedAttempts[0].stage, WORKFLOW_STAGES.EVIDENCE);
  });
});

describe('Workflow confidence failure', () => {
  it('fails when confidence analysis fails', async () => {
    const failing = buildOrchestrator({
      confidenceEngine: failingEngine<ConfidenceRequest, ConfidenceResult>(
        'Confidence Engine',
        'CONFIDENCE_FAILED',
        'Insufficient telemetry history'
      ),
    });

    const result = await failing.executeWorkflow({ plugin: PLUGIN_NAMES.EC2, mode: 'full' });

    assert.equal(result.status, WORKFLOW_STATES.FAILED);
    assert.equal(result.failure?.failedStage, WORKFLOW_STAGES.CONFIDENCE);
  });
});
