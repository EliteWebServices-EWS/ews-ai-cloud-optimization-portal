/**
 * Demo report HTTP gate — mock provider + POST /reports/generate only.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { createReportRoutes, createWorkflowRoutes } from '../../api/routes';
import { requireTenantContext } from '../../auth';
import {
  createConfidenceEngine,
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createLearningStore,
  createRecommendationEngine,
  createReportingEngine,
  createVerificationEngine,
} from '../../engines';
import { createExecutionSimulator } from '../../execution';
import { createWorkflowOrchestrator, createWorkflowStore } from '../../orchestrator';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';

const TENANT = 'tenant-demo-gate';

function buildOrchestrator() {
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
    workflowStore: createWorkflowStore(),
  });
}

async function postJson(
  app: express.Application,
  path: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sisum-authenticated': 'true',
        'x-sisum-user-id': 'gate-test-user',
        'x-sisum-user-email': 'analyst@example.com',
        'x-sisum-user-groups': 'analyst',
        'x-sisum-tenant-id': TENANT,
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('Workflow demo report HTTP gate', () => {
  let previousProvider: string | undefined;
  let previousDemo: string | undefined;

  beforeEach(() => {
    previousProvider = process.env.PROVIDER_MODE;
    previousDemo = process.env.WORKFLOW_DEMO_REPORTS_ENABLED;
    process.env.PROVIDER_MODE = PROVIDER_NAMES.MOCK;
    process.env.WORKFLOW_DEMO_REPORTS_ENABLED = 'false';
  });

  afterEach(() => {
    if (previousProvider === undefined) {
      delete process.env.PROVIDER_MODE;
    } else {
      process.env.PROVIDER_MODE = previousProvider;
    }
    if (previousDemo === undefined) {
      delete process.env.WORKFLOW_DEMO_REPORTS_ENABLED;
    } else {
      process.env.WORKFLOW_DEMO_REPORTS_ENABLED = previousDemo;
    }
  });

  it('allows POST /workflows/run when demo report generation is disabled', async () => {
    const orchestrator = buildOrchestrator();
    const app = express();
    app.use(express.json());
    app.use(requireTenantContext());
    app.use('/api/v1', createWorkflowRoutes({ orchestrator }));

    const response = await postJson(app, '/api/v1/workflows/run', {
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    assert.notEqual(response.status, 403);
    const err = response.body.error as { code?: string } | undefined;
    assert.notEqual(err?.code, 'DEMO_REPORTS_DISABLED');
  });

  it('blocks POST /reports/generate when demo report generation is disabled on mock provider', async () => {
    const orchestrator = buildOrchestrator();
    const reportingEngine = createReportingEngine();
    const workflow = await orchestrator.executeWorkflow({
      tenantId: TENANT,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const app = express();
    app.use(express.json());
    app.use(requireTenantContext());
    app.use(
      '/api/v1',
      createReportRoutes({ orchestrator, reportingEngine }),
    );

    const response = await postJson(app, '/api/v1/reports/generate', {
      workflowId: workflow.workflowId,
    });

    assert.equal(response.status, 403);
    assert.equal(
      (response.body.error as { code?: string } | undefined)?.code,
      'DEMO_REPORTS_DISABLED',
    );
  });
});
