/**
 * Cross-tenant isolation tests.
 * Sprint 10.5.16: tenant boundary enforcement across stores and orchestrator.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createConfidenceEngine,
  createRecommendationEngine,
  createVerificationEngine,
  createLearningStore,
  createReportingEngine,
} from '../../engines';
import { createExecutionSimulator } from '../../execution';
import {
  createWorkflowOrchestrator,
  createWorkflowStore,
} from '../../orchestrator';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { PLUGIN_NAMES, PROVIDER_NAMES, WORKFLOW_STATES } from '../../shared/constants';
import { toReportGenerationInput } from '../../engines/reporting/report.engine';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function buildOrchestrator() {
  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);
  const learningStore = createLearningStore();
  const executionSimulator = createExecutionSimulator();
  const workflowStore = createWorkflowStore();

  return createWorkflowOrchestrator({
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
  });
}

describe('Workflow tenant isolation', () => {
  let orchestrator: ReturnType<typeof buildOrchestrator>;

  beforeEach(() => {
    orchestrator = buildOrchestrator();
  });

  it('Tenant A creates and reads own workflow', async () => {
    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const record = orchestrator.getWorkflow(TENANT_A, result.workflowId);
    assert.ok(record);
    assert.equal(record.metadata.tenantId, TENANT_A);
  });

  it('Tenant B receives undefined for Tenant A workflow ID', async () => {
    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.equal(
      orchestrator.getWorkflow(TENANT_B, result.workflowId),
      undefined
    );
    assert.equal(
      orchestrator.getWorkflowStatus(TENANT_B, result.workflowId),
      undefined
    );
  });

  it('workflow status lookup is tenant scoped', async () => {
    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'dry-run',
    });

    const status = orchestrator.getWorkflowStatus(
      TENANT_A,
      result.workflowId
    );

    assert.ok(status);
    assert.equal(status.metadata.tenantId, TENANT_A);
  });
});

describe('Report tenant isolation', () => {
  it('Tenant B cannot fetch Tenant A report by workflow ID', async () => {
    const orchestrator = buildOrchestrator();
    const reportingEngine = createReportingEngine();

    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const record = orchestrator.getWorkflow(
      TENANT_A,
      result.workflowId
    );

    assert.ok(record);

    const reportResult = reportingEngine.execute(
      toReportGenerationInput(record)
    );

    assert.equal(reportResult.success, true);
    assert.equal(reportResult.data?.tenantId, TENANT_A);

    assert.equal(
      reportingEngine.getReportByWorkflowId(
        TENANT_B,
        result.workflowId
      ),
      undefined
    );
  });

  it('Tenant report lists are isolated', async () => {
    const orchestrator = buildOrchestrator();
    const reportingEngine = createReportingEngine();

    const resultA = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const recordA = orchestrator.getWorkflow(
      TENANT_A,
      resultA.workflowId
    );

    assert.ok(recordA);
    reportingEngine.execute(toReportGenerationInput(recordA));

    const resultB = await orchestrator.executeWorkflow({
      tenantId: TENANT_B,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const recordB = orchestrator.getWorkflow(
      TENANT_B,
      resultB.workflowId
    );

    assert.ok(recordB);
    reportingEngine.execute(toReportGenerationInput(recordB));

    assert.equal(reportingEngine.listReports(TENANT_A).length, 1);
    assert.equal(reportingEngine.listReports(TENANT_B).length, 1);
    assert.notEqual(
      reportingEngine.listReports(TENANT_A)[0]?.reportId,
      reportingEngine.listReports(TENANT_B)[0]?.reportId
    );
  });
});

describe('Learning store tenant isolation', () => {
  it('Tenant B cannot access Tenant A learning record', async () => {
    const provider = createProvider(PROVIDER_NAMES.MOCK);
    const pluginRegistry = createPluginRegistry(provider);
    const learningStore = createLearningStore();
    const orchestrator = createWorkflowOrchestrator({
      evidenceEngine: createEvidenceEngine(),
      governanceEngine: createGovernanceEngine(),
      financialEngine: createFinancialEngine({ provider }),
      confidenceEngine: createConfidenceEngine(),
      recommendationEngine: createRecommendationEngine(),
      verificationEngine: createVerificationEngine(),
      executionSimulator: createExecutionSimulator(),
      learningStore,
      getPlugin: (name) => pluginRegistry.get(name),
      workflowStore: createWorkflowStore(),
    });

    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const record = orchestrator.getWorkflow(
      TENANT_A,
      result.workflowId
    );

    assert.ok(record?.context.learningRecord);
    assert.equal(record.context.learningRecord.tenantId, TENANT_A);

    assert.equal(
      learningStore.getByWorkflowId(
        TENANT_B,
        result.workflowId
      ),
      undefined
    );
  });
});

describe('Execution tenant metadata', () => {
  it('execution simulation stamps tenant ID from workflow context', async () => {
    const orchestrator = buildOrchestrator();
    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const record = orchestrator.getWorkflow(
      TENANT_A,
      result.workflowId
    );

    assert.ok(record?.context.execution);
    assert.equal(record.context.execution.metadata.tenantId, TENANT_A);
    assert.equal(record.metadata.status, WORKFLOW_STATES.COMPLETED);
  });
});
