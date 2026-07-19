import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import {
  resetAuditRepository,
  setAuditRepository,
  type AuditRepository,
} from '../../audit';
import { createAdminAuditRoutes } from '../../api/routes';
import type { SisumRole } from '../../auth';

function createTestApp(role: SisumRole | null) {
  const app = express();

  app.use((req, _res, next) => {
    if (role) {
      req.headers['x-sisum-authenticated'] = 'true';
      req.headers['x-sisum-user-id'] = `${role}-user`;
      req.headers['x-sisum-user-email'] = `${role}@example.com`;
      req.headers['x-sisum-user-groups'] = role;
    }

    next();
  });

  app.use('/api/v1', createAdminAuditRoutes());

  return app;
}

async function getJson(
  app: express.Application,
  path: string
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
    const response = await fetch(
      `http://127.0.0.1:${address.port}${path}`
    );

    const body = (await response.json()) as Record<
      string,
      unknown
    >;

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

test('admin can query audit events when persistence is enabled', async () => {
  const repository: AuditRepository = {
    async save() {},
    async query() {
      return {
        items: [
          {
            eventId: 'event-admin',
            timestamp: '2026-07-19T12:00:00.000Z',
            eventName: 'workflow.completed',
            outcome: 'success',
            level: 'info',
            actorUserId: 'admin-user',
            actorEmail: 'admin@example.com',
            actorRoles: ['admin'],
            requestId: 'req-admin',
            correlationId: 'corr-admin',
            schemaVersion: 1,
            expiresAt: 1800000000,
            tenantId: 'sisum-default',
            environment: 'test',
          },
        ],
      };
    },
  };

  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  process.env.AUDIT_TABLE_NAME = 'sisum-audit-test';

  setAuditRepository(repository);

  const app = createTestApp('admin');
  const response = await getJson(
    app,
    '/api/v1/admin/audit-events?limit=10'
  );

  assert.equal(response.status, 200);
  assert.equal(
    (response.body.data as { count: number }).count,
    1
  );

  resetAuditRepository();
  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  delete process.env.AUDIT_TABLE_NAME;
});

test('viewer cannot query audit events', async () => {
  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  process.env.AUDIT_TABLE_NAME = 'sisum-audit-test';

  const app = createTestApp('viewer');
  const response = await getJson(
    app,
    '/api/v1/admin/audit-events'
  );

  assert.equal(response.status, 403);

  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  delete process.env.AUDIT_TABLE_NAME;
});

test('analyst cannot query audit events', async () => {
  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  process.env.AUDIT_TABLE_NAME = 'sisum-audit-test';

  const app = createTestApp('analyst');
  const response = await getJson(
    app,
    '/api/v1/admin/audit-events'
  );

  assert.equal(response.status, 403);

  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  delete process.env.AUDIT_TABLE_NAME;
});

test('audit query returns 503 when persistence is disabled', async () => {
  process.env.AUDIT_PERSISTENCE_ENABLED = 'false';

  const app = createTestApp('admin');
  const response = await getJson(
    app,
    '/api/v1/admin/audit-events'
  );

  assert.equal(response.status, 503);

  delete process.env.AUDIT_PERSISTENCE_ENABLED;
});
