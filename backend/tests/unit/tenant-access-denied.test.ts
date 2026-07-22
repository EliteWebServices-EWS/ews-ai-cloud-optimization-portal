/**
 * Cross-tenant access audit tests.
 * Sprint 10.5.16: tenant.access_denied on cross-tenant workflow/report lookups.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { beforeEach, describe, it } from 'node:test';
import express from 'express';
import type { AuditEvent } from '../../audit';
import { AUDIT_EVENTS } from '../../audit';
import {
  createReportRoutes,
  createWorkflowRoutes,
} from '../../api/routes';
import { handleTenantScopedResourceMiss } from '../../api/tenant-route-helpers';
import { requireTenantContext } from '../../auth';
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
import { toReportGenerationInput } from '../../engines/reporting/report.engine';
import { createExecutionSimulator } from '../../execution';
import {
  createWorkflowOrchestrator,
  createWorkflowStore,
} from '../../orchestrator';
import { createPluginRegistry } from '../../plugins';
import { createProvider } from '../../providers';
import { PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';

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

function createMockRequest(
  tenantId: string,
  overrides: {
    userId?: string;
    path?: string;
    method?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    'x-sisum-authenticated': 'true',
    'x-sisum-user-id': overrides.userId ?? 'test-user',
    'x-sisum-user-email': 'analyst@example.com',
    'x-sisum-user-groups': 'analyst',
    'x-sisum-tenant-id': tenantId,
  };

  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/api/v1/workflows/test-workflow',
  } as express.Request;
}

function createWorkflowRouteApp(
  orchestrator: ReturnType<typeof buildOrchestrator>
) {
  const app = express();
  app.use(express.json());
  app.use(requireTenantContext());
  app.use('/api/v1', createWorkflowRoutes({ orchestrator }));
  return app;
}

async function requestJson(
  app: express.Application,
  path: string,
  tenantId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: {
        'x-sisum-authenticated': 'true',
        'x-sisum-user-id': 'route-test-user',
        'x-sisum-user-email': 'analyst@example.com',
        'x-sisum-user-groups': 'analyst',
        'x-sisum-tenant-id': tenantId,
      },
    });

    const body = (await response.json()) as Record<string, unknown>;

    return {
      status: response.status,
      body,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function captureAuditEvents(): {
  events: AuditEvent[];
  restore: () => void;
} {
  const events: AuditEvent[] = [];
  const originalWarn = console.warn;

  console.warn = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg !== 'string') {
        continue;
      }

      try {
        const parsed = JSON.parse(arg) as AuditEvent;

        if (parsed.category === 'audit') {
          events.push(parsed);
        }
      } catch {
        // Ignore non-audit console output.
      }
    }

    originalWarn.apply(console, args);
  };

  return {
    events,
    restore: () => {
      console.warn = originalWarn;
    },
  };
}

function assertResponseDoesNotLeakTenant(
  body: Record<string, unknown>,
  leakedTenantId: string
): void {
  const serialized = JSON.stringify(body).toLowerCase();

  assert.equal(
    serialized.includes(leakedTenantId.toLowerCase()),
    false,
    `API response leaked tenant ownership: ${leakedTenantId}`
  );
}

async function requestJsonPost(
  app: express.Application,
  path: string,
  tenantId: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

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
        'x-sisum-user-id': 'route-test-user',
        'x-sisum-user-email': 'analyst@example.com',
        'x-sisum-user-groups': 'analyst',
        'x-sisum-tenant-id': tenantId,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as Record<string, unknown>;

    return {
      status: response.status,
      body,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function createReportRouteApp(
  orchestrator: ReturnType<typeof buildOrchestrator>,
  reportingEngine: ReturnType<typeof createReportingEngine>
) {
  const app = express();
  app.use(express.json());
  app.use(requireTenantContext());
  app.use(
    '/api/v1',
    createReportRoutes({
      orchestrator,
      reportingEngine,
    })
  );
  return app;
}

describe('handleTenantScopedResourceMiss', () => {
  it('emits tenant.access_denied when resource exists under another tenant', () => {
    const capture = captureAuditEvents();

    try {
      const req = createMockRequest(TENANT_A, {
        path: '/api/v1/workflows/wf-tenant-b',
      });

      assert.throws(
        () =>
          handleTenantScopedResourceMiss(req, {
            resourceType: 'workflow',
            resourceId: 'wf-tenant-b',
            ownerTenantId: TENANT_B,
            label: 'Workflow',
          }),
        /Workflow not found: wf-tenant-b/
      );

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 1);
      assert.equal(deniedEvents[0]?.tenantId, TENANT_A);
      assert.equal(deniedEvents[0]?.resourceTenantId, TENANT_B);
      assert.equal(deniedEvents[0]?.resource?.type, 'workflow');
      assert.equal(deniedEvents[0]?.resource?.id, 'wf-tenant-b');
      assert.equal(deniedEvents[0]?.actor.userId, 'test-user');
      assert.ok(deniedEvents[0]?.requestId);
      assert.ok(deniedEvents[0]?.correlationId);
      assert.equal(deniedEvents[0]?.statusCode, 404);
      assert.equal(deniedEvents[0]?.errorCode, 'NOT_FOUND');
    } finally {
      capture.restore();
    }
  });

  it('does not emit tenant.access_denied for genuinely missing resources', () => {
    const capture = captureAuditEvents();

    try {
      const req = createMockRequest(TENANT_A, {
        path: '/api/v1/workflows/missing-workflow',
      });

      assert.throws(
        () =>
          handleTenantScopedResourceMiss(req, {
            resourceType: 'workflow',
            resourceId: 'missing-workflow',
            ownerTenantId: undefined,
            label: 'Workflow',
          }),
        /Workflow not found: missing-workflow/
      );

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 0);
    } finally {
      capture.restore();
    }
  });
});

describe('Workflow route tenant access audit', () => {
  let orchestrator: ReturnType<typeof buildOrchestrator>;
  let tenantAWorkflowId: string;
  let tenantBWorkflowId: string;

  beforeEach(async () => {
    orchestrator = buildOrchestrator();

    const resultA = await orchestrator.executeWorkflow({
      tenantId: TENANT_A,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'dry-run',
    });

    const resultB = await orchestrator.executeWorkflow({
      tenantId: TENANT_B,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'dry-run',
    });

    tenantAWorkflowId = resultA.workflowId;
    tenantBWorkflowId = resultB.workflowId;
  });

  it('Tenant A reads own workflow with 200', async () => {
    const app = createWorkflowRouteApp(orchestrator);
    const response = await requestJson(
      app,
      `/api/v1/workflows/${tenantAWorkflowId}`,
      TENANT_A
    );

    assert.equal(response.status, 200);
    assert.equal(
      (
        response.body.data as
          | { metadata?: { workflowId?: string } }
          | undefined
      )?.metadata?.workflowId,
      tenantAWorkflowId
    );
  });

  it('Tenant B reads own workflow with 200', async () => {
    const app = createWorkflowRouteApp(orchestrator);
    const response = await requestJson(
      app,
      `/api/v1/workflows/${tenantBWorkflowId}`,
      TENANT_B
    );

    assert.equal(response.status, 200);
    assert.equal(
      (
        response.body.data as
          | { metadata?: { workflowId?: string } }
          | undefined
      )?.metadata?.workflowId,
      tenantBWorkflowId
    );
  });

  it('Tenant A accessing Tenant B workflow returns 404 and emits tenant.access_denied', async () => {
    const capture = captureAuditEvents();
    const app = createWorkflowRouteApp(orchestrator);

    try {
      const response = await requestJson(
        app,
        `/api/v1/workflows/${tenantBWorkflowId}`,
        TENANT_A
      );

      assert.equal(response.status, 404);
      assert.equal(
        (response.body.error as { code?: string } | undefined)?.code,
        'NOT_FOUND'
      );
      assertResponseDoesNotLeakTenant(response.body, TENANT_B);

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 1);
      assert.equal(deniedEvents[0]?.tenantId, TENANT_A);
      assert.equal(deniedEvents[0]?.resourceTenantId, TENANT_B);
      assert.equal(deniedEvents[0]?.resource?.type, 'workflow');
      assert.equal(deniedEvents[0]?.resource?.id, tenantBWorkflowId);
      assert.equal(deniedEvents[0]?.actor.userId, 'route-test-user');
      assert.ok(deniedEvents[0]?.requestId);
      assert.ok(deniedEvents[0]?.correlationId);
    } finally {
      capture.restore();
    }
  });

  it('Tenant A accessing nonexistent workflow returns 404 without tenant.access_denied', async () => {
    const capture = captureAuditEvents();
    const app = createWorkflowRouteApp(orchestrator);

    try {
      const response = await requestJson(
        app,
        '/api/v1/workflows/does-not-exist',
        TENANT_A
      );

      assert.equal(response.status, 404);
      assert.equal(
        (response.body.error as { code?: string } | undefined)?.code,
        'NOT_FOUND'
      );

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 0);
    } finally {
      capture.restore();
    }
  });
});

describe('Report route tenant access audit', () => {
  it('Tenant A accessing Tenant B report returns 404 and emits tenant.access_denied', async () => {
    const orchestrator = buildOrchestrator();
    const reportingEngine = createReportingEngine();
    const capture = captureAuditEvents();

    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_B,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const record = orchestrator.getWorkflow(TENANT_B, result.workflowId);
    assert.ok(record);

    const reportResult = await reportingEngine.execute(
      toReportGenerationInput(record)
    );

    assert.equal(reportResult.success, true);
    const reportId = reportResult.data?.reportId;
    assert.ok(reportId);

    const app = createReportRouteApp(orchestrator, reportingEngine);

    try {
      const response = await requestJson(
        app,
        `/api/v1/reports/${reportId}`,
        TENANT_A
      );

      assert.equal(response.status, 404);
      assertResponseDoesNotLeakTenant(response.body, TENANT_B);

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 1);
      assert.equal(deniedEvents[0]?.tenantId, TENANT_A);
      assert.equal(deniedEvents[0]?.resourceTenantId, TENANT_B);
      assert.equal(deniedEvents[0]?.resource?.type, 'report');
      assert.equal(deniedEvents[0]?.resource?.id, reportId);
      assert.equal(deniedEvents[0]?.actor.userId, 'route-test-user');
      assert.ok(deniedEvents[0]?.requestId);
      assert.ok(deniedEvents[0]?.correlationId);
    } finally {
      capture.restore();
    }
  });

  it('Tenant A accessing nonexistent report returns 404 without tenant.access_denied', async () => {
    const orchestrator = buildOrchestrator();
    const reportingEngine = createReportingEngine();
    const capture = captureAuditEvents();
    const app = createReportRouteApp(orchestrator, reportingEngine);

    try {
      const response = await requestJson(
        app,
        '/api/v1/reports/report-does-not-exist',
        TENANT_A
      );

      assert.equal(response.status, 404);
      assert.equal(
        (response.body.error as { code?: string } | undefined)?.code,
        'NOT_FOUND'
      );

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 0);
    } finally {
      capture.restore();
    }
  });

  it('Tenant A requesting cached Tenant B report by workflow ID returns 404 and emits tenant.access_denied', async () => {
    const orchestrator = buildOrchestrator();
    const reportingEngine = createReportingEngine();
    const capture = captureAuditEvents();

    const result = await orchestrator.executeWorkflow({
      tenantId: TENANT_B,
      plugin: PLUGIN_NAMES.EC2,
      mode: 'full',
    });

    const record = orchestrator.getWorkflow(TENANT_B, result.workflowId);
    assert.ok(record);

    const reportResult = await reportingEngine.execute(
      toReportGenerationInput(record)
    );

    assert.equal(reportResult.success, true);

    const app = createReportRouteApp(orchestrator, reportingEngine);

    try {
      const response = await requestJsonPost(
        app,
        '/api/v1/reports/generate',
        TENANT_A,
        { workflowId: result.workflowId }
      );

      assert.equal(response.status, 404);
      assertResponseDoesNotLeakTenant(response.body, TENANT_B);

      const deniedEvents = capture.events.filter(
        (event) => event.eventName === AUDIT_EVENTS.TENANT_ACCESS_DENIED
      );

      assert.equal(deniedEvents.length, 1);
      assert.equal(deniedEvents[0]?.tenantId, TENANT_A);
      assert.equal(deniedEvents[0]?.resourceTenantId, TENANT_B);
      assert.equal(deniedEvents[0]?.resource?.type, 'report');
      assert.equal(deniedEvents[0]?.resource?.id, result.workflowId);
      assert.equal(deniedEvents[0]?.actor.userId, 'route-test-user');
      assert.ok(deniedEvents[0]?.requestId);
      assert.ok(deniedEvents[0]?.correlationId);
    } finally {
      capture.restore();
    }
  });
});
