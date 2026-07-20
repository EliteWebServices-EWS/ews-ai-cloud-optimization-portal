import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { requireAnyRole } from '../../auth/require-role';
import { SISUM_ROLES } from '../../auth/roles';

function createAuthApp(roleHeader?: string) {
  const app = express();

  app.use((req, _res, next) => {
    if (roleHeader !== undefined) {
      req.headers['x-sisum-authenticated'] = 'true';
      req.headers['x-sisum-user-id'] = 'test-user';
      req.headers['x-sisum-user-email'] = 'test@example.com';
      req.headers['x-sisum-user-groups'] = roleHeader;
    }

    next();
  });

  app.get(
    '/admin',
    requireAnyRole(SISUM_ROLES.ADMIN),
    (_req, res) => {
      res.json({ ok: true });
    }
  );

  app.get(
    '/analysis',
    requireAnyRole(SISUM_ROLES.ANALYST, SISUM_ROLES.ADMIN),
    (_req, res) => {
      res.json({ ok: true });
    }
  );

  app.get(
    '/viewer',
    requireAnyRole(
      SISUM_ROLES.VIEWER,
      SISUM_ROLES.ANALYST,
      SISUM_ROLES.ADMIN
    ),
    (_req, res) => {
      res.json({ ok: true });
    }
  );

  return app;
}

async function getStatus(
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

    return { status: response.status, body };
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

test('missing identity returns 401', async () => {
  const response = await getStatus(createAuthApp(), '/viewer');

  assert.equal(response.status, 401);
  assert.equal(
    (response.body.error as { code: string }).code,
    'AUTHENTICATION_REQUIRED'
  );
});

test('unknown Cognito group returns ROLE_UNRECOGNIZED', async () => {
  const response = await getStatus(
    createAuthApp('contractor'),
    '/viewer'
  );

  assert.equal(response.status, 403);
  assert.equal(
    (response.body.error as { code: string }).code,
    'ROLE_UNRECOGNIZED'
  );
});

test('viewer can access viewer routes', async () => {
  const response = await getStatus(
    createAuthApp(SISUM_ROLES.VIEWER),
    '/viewer'
  );

  assert.equal(response.status, 200);
});

test('viewer cannot access admin routes', async () => {
  const response = await getStatus(
    createAuthApp(SISUM_ROLES.VIEWER),
    '/admin'
  );

  assert.equal(response.status, 403);
  assert.equal(
    (response.body.error as { code: string }).code,
    'FORBIDDEN'
  );
});

test('analyst can access analysis routes', async () => {
  const response = await getStatus(
    createAuthApp(SISUM_ROLES.ANALYST),
    '/analysis'
  );

  assert.equal(response.status, 200);
});

test('admin can access admin routes', async () => {
  const response = await getStatus(
    createAuthApp(SISUM_ROLES.ADMIN),
    '/admin'
  );

  assert.equal(response.status, 200);
});

test('multiple recognized groups allow access when one matches', async () => {
  const response = await getStatus(
    createAuthApp('contractor,viewer'),
    '/viewer'
  );

  assert.equal(response.status, 200);
});
