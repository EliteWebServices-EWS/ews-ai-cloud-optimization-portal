import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import {
  createSecurityHeadersMiddleware,
  getSecurityHeaders,
} from '../../security/security-headers';
import {
  createJsonBodyParser,
  createJsonErrorHandler,
} from '../../security/request-limits';
import { requireAnyRole } from '../../auth/require-role';
import { SISUM_ROLES } from '../../auth/roles';

const EXPECTED_CSP =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

function createHeadersApp(options?: {
  authenticated?: boolean;
  role?: string;
  failWith500?: boolean;
  includeJsonParser?: boolean;
}) {
  const app = express();

  app.use(createSecurityHeadersMiddleware());

  app.use((req, _res, next) => {
    if (options?.authenticated) {
      req.headers['x-sisum-authenticated'] = 'true';
      req.headers['x-sisum-user-id'] = 'user-1';
      req.headers['x-sisum-user-email'] = 'user@example.com';
      req.headers['x-sisum-user-groups'] =
        options.role ?? SISUM_ROLES.VIEWER;
    }

    next();
  });

  if (options?.includeJsonParser) {
    app.use(createJsonBodyParser());
    app.use(createJsonErrorHandler());
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  app.get(
    '/protected',
    requireAnyRole(SISUM_ROLES.ADMIN),
    (_req, res) => {
      res.json({ ok: true });
    }
  );

  app.post('/echo', (req, res) => {
    res.json({ received: req.body });
  });

  app.get('/boom', () => {
    if (options?.failWith500) {
      throw new Error('Unexpected failure');
    }
  });

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(500).json({ error: error.message });
    }
  );

  return app;
}

async function getHeaders(
  app: express.Application,
  path: string,
  init?: RequestInit
): Promise<{ status: number; headers: Headers }> {
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
      `http://127.0.0.1:${address.port}${path}`,
      init
    );

    return {
      status: response.status,
      headers: response.headers,
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

test('Content-Security-Policy contains default-src none', () => {
  const csp = getSecurityHeaders()['Content-Security-Policy'];

  assert.match(csp, /default-src 'none'/);
});

test('Content-Security-Policy contains base-uri none', () => {
  const csp = getSecurityHeaders()['Content-Security-Policy'];

  assert.match(csp, /base-uri 'none'/);
});

test('Content-Security-Policy contains frame-ancestors none', () => {
  const csp = getSecurityHeaders()['Content-Security-Policy'];

  assert.match(csp, /frame-ancestors 'none'/);
});

test('Content-Security-Policy contains form-action none', () => {
  const csp = getSecurityHeaders()['Content-Security-Policy'];

  assert.match(csp, /form-action 'none'/);
});

test('Content-Security-Policy does not contain unsafe-inline', () => {
  const csp = getSecurityHeaders()['Content-Security-Policy'];

  assert.doesNotMatch(csp, /unsafe-inline/);
});

test('Content-Security-Policy does not contain unsafe-eval', () => {
  const csp = getSecurityHeaders()['Content-Security-Policy'];

  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('getSecurityHeaders includes required API security headers', () => {
  const headers = getSecurityHeaders();

  assert.equal(
    headers['Content-Security-Policy'],
    EXPECTED_CSP
  );
  assert.match(headers['Strict-Transport-Security'], /max-age=/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Referrer-Policy'], /origin/);
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
  assert.match(headers['Cache-Control'], /no-store/);
  assert.match(headers['Cache-Control'], /no-cache/);
  assert.match(headers['Cache-Control'], /private/);
});

test('health route includes security headers', async () => {
  const { headers } = await getHeaders(
    createHeadersApp(),
    '/health'
  );

  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(
    headers.get('content-security-policy'),
    EXPECTED_CSP
  );
});

test('403 response includes security headers', async () => {
  const { headers } = await getHeaders(
    createHeadersApp({
      authenticated: true,
      role: SISUM_ROLES.VIEWER,
    }),
    '/protected'
  );

  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(
    headers.get('content-security-policy'),
    EXPECTED_CSP
  );
});

test('401 response includes security headers', async () => {
  const { headers } = await getHeaders(
    createHeadersApp({ authenticated: false }),
    '/protected'
  );

  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(
    headers.get('content-security-policy'),
    EXPECTED_CSP
  );
});

test('500 response includes security headers', async () => {
  const { headers } = await getHeaders(
    createHeadersApp({ failWith500: true }),
    '/boom'
  );

  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(
    headers.get('content-security-policy'),
    EXPECTED_CSP
  );
});

test('structured JSON parsing errors include security headers', async () => {
  const { status, headers } = await getHeaders(
    createHeadersApp({ includeJsonParser: true }),
    '/echo',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{invalid',
    }
  );

  assert.equal(status, 400);
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(
    headers.get('content-security-policy'),
    EXPECTED_CSP
  );
  assert.match(headers.get('cache-control') ?? '', /no-store/);
});
