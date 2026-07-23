import { describe, it } from 'node:test';
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
import { createWorkflowOrchestrator, createWorkflowStore } from '../../orchestrator';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { PLUGIN_NAMES, PROVIDER_NAMES, WORKFLOW_STATES } from '../../shared/constants';
const TENANT_ID = 'integration-workflow-tenant';
function buildIntegrationContext() {
  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);
  const learningStore = createLearningStore();
  const workflowStore = createWorkflowStore();
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
    workflowStore,
  });
  return { orchestrator, workflowStore };
}
describe('Workflow persistence integration', () => {
  it('creates a workflow, reads metadata, and validates tenant-scoped lookup', async () => {
    const { orchestrator } = buildIntegrationContext();
    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_ID,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });
    assert.equal(result.status, WORKFLOW_STATES.COMPLETED);
    const record = await orchestrator.getWorkflow(TENANT_ID, result.workflowId);
    assert.ok(record);
    assert.equal(record?.metadata.workflowId, result.workflowId);
    assert.equal(record?.metadata.status, WORKFLOW_STATES.COMPLETED);
    const status = await orchestrator.getWorkflowStatus(TENANT_ID, result.workflowId);
    assert.ok(status);
    assert.equal(status?.metadata.workflowId, result.workflowId);
    assert.equal(status?.metadata.status, WORKFLOW_STATES.COMPLETED);
    assert.equal(await orchestrator.getWorkflow('other-tenant', result.workflowId), undefined);
  });
  it('stores workflow metadata in the workflow store and resolves owner tenant', async () => {
    const { orchestrator, workflowStore } = buildIntegrationContext();
    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_ID,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });
    const list = await workflowStore.list(TENANT_ID);
    assert.equal(list.length, 1);
    assert.equal(list[0].workflowId, result.workflowId);
    assert.equal(await workflowStore.resolveOwnerTenantId(result.workflowId), TENANT_ID);
  });
});