import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createWorkflowRoutes } from '../../api/routes';
import { requireTenantContext } from '../../auth';
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
  InMemoryWorkflowStore,
  createRetryState,
} from '../../orchestrator';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import {
  PLUGIN_NAMES,
  PROVIDER_NAMES,
  WORKFLOW_EXECUTION_STATES,
  WORKFLOW_STATES,
} from '../../shared/constants';
import type { WorkflowMetadata, WorkflowRecord } from '../../orchestrator/workflow.types';

const TENANT_ID = 'integration-workflow-list-tenant';

function buildOrchestrator(store: InMemoryWorkflowStore) {
  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);

  return createWorkflowOrchestrator({
    evidenceEngine: createEvidenceEngine(),
    governanceEngine: createGovernanceEngine(),
    financialEngine: createFinancialEngine({ provider }),
    confidenceEngine: createConfidenceEngine(),
    recommendationEngine: createRecommendationEngine(),
    verificationEngine: createVerificationEngine(),
    executionSimulator: createExecutionSimulator(),
    learningStore: createLearningStore(),
    getPlugin: (name) => pluginRegistry.get(name),
    workflowStore: store,
  });
}

function seedRecord(
  store: InMemoryWorkflowStore,
  workflowId: string,
  createdAt: string,
  status: WorkflowMetadata['status'] = WORKFLOW_STATES.COMPLETED
): Promise<void> {
  const metadata: WorkflowMetadata = {
    workflowId,
    tenantId: TENANT_ID,
    plugin: PLUGIN_NAMES.EC2,
    createdAt,
    updatedAt: createdAt,
    status,
    executionState: WORKFLOW_EXECUTION_STATES.COMPLETED,
    triggerSource: 'api',
    region: 'us-east-1',
  };

  const record: WorkflowRecord = {
    metadata,
    context: {
      workflowId,
      tenantId: TENANT_ID,
      plugin: PLUGIN_NAMES.EC2,
      provider: PROVIDER_NAMES.MOCK,
      region: 'us-east-1',
      mode: 'demo',
      triggerSource: 'api',
      startedAt: createdAt,
      status,
      executionState: WORKFLOW_EXECUTION_STATES.COMPLETED,
      completedStages: [],
      failedStages: [],
      retry: createRetryState(3),
    },
  };

  return store.save(record);
}

async function requestJson(
  app: express.Application,
  path: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to bind test server'));
        return;
      }

      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: 'GET',
          headers: {
            'x-sisum-authenticated': 'true',
            'x-sisum-user-id': 'list-test-user',
            'x-sisum-user-email': 'list@example.com',
            'x-sisum-user-groups': 'analyst',
            'x-sisum-tenant-id': TENANT_ID,
          },
        },
        (response) => {
          let payload = '';
          response.on('data', (chunk) => {
            payload += chunk;
          });
          response.on('end', () => {
            server.close();
            resolve({
              status: response.statusCode ?? 500,
              body: JSON.parse(payload) as Record<string, unknown>,
            });
          });
        }
      );

      request.on('error', (error) => {
        server.close();
        reject(error);
      });
      request.end();
    });
  });
}

describe('Workflow list API pagination', () => {
  it('returns items and nextToken without loading every page internally', async () => {
    const store = new InMemoryWorkflowStore();
    await seedRecord(store, 'wf-list-001', '2026-01-03T00:00:00.000Z');
    await seedRecord(store, 'wf-list-002', '2026-01-02T00:00:00.000Z');
    await seedRecord(store, 'wf-list-003', '2026-01-01T00:00:00.000Z');

    const orchestrator = buildOrchestrator(store);
    const app = express();
    app.use(requireTenantContext());
    app.use('/api/v1', createWorkflowRoutes({ orchestrator }));

    const first = await requestJson(app, '/api/v1/workflows?limit=2');
    assert.equal(first.status, 200);

    const firstData = first.body.data as {
      items: Array<{ workflowId: string }>;
      pagination: { limit: number; count: number; nextToken?: string };
    };

    assert.equal(firstData.pagination.limit, 2);
    assert.equal(firstData.pagination.count, 2);
    assert.equal(firstData.items.length, 2);
    assert.ok(firstData.pagination.nextToken);

    const second = await requestJson(
      app,
      `/api/v1/workflows?limit=2&nextToken=${encodeURIComponent(firstData.pagination.nextToken!)}`
    );
    assert.equal(second.status, 200);

    const secondData = second.body.data as {
      items: Array<{ workflowId: string }>;
      pagination: { count: number; nextToken?: string };
    };

    assert.equal(secondData.pagination.count, 1);
    assert.equal(secondData.items.length, 1);
    assert.equal(secondData.pagination.nextToken, undefined);
  });
});
