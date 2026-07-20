import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import express from 'express';
import {
  CLOUDFRONT_FALLBACK_ORIGIN,
  createCorsMiddleware,
  isWildcardCorsEnabled,
  PRODUCTION_CORS_ORIGINS,
  resolveAllowedOrigins,
} from '../../security/cors';

const ENV_KEYS = [
  'NODE_ENV',
  'CORS_ORIGIN',
  'CORS_ALLOWED_ORIGINS',
  'CORS_ALLOW_LOCAL',
] as const;

const envSnapshot: Partial<
  Record<(typeof ENV_KEYS)[number], string | undefined>
> = {};

function snapshotEnv(): void {
  for (const key of ENV_KEYS) {
    envSnapshot[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envSnapshot[key];
    }
  }
}

afterEach(() => {
  restoreEnv();
});

function createCorsApp(allowedOrigins?: readonly string[]) {
  const app = express();

  app.use(createCorsMiddleware(allowedOrigins));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

async function request(
  app: express.Application,
  options: {
    method?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{
  status: number;
  headers: Headers;
}> {
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  try {
    const headers = new Headers(options.headers);

    if (options.origin) {
      headers.set('Origin', options.origin);
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/health`,
      {
        method: options.method ?? 'GET',
        headers,
      }
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

test('resolveAllowedOrigins returns production allowlist by default', () => {
  snapshotEnv();
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.CORS_ORIGIN;
  delete process.env.CORS_ALLOW_LOCAL;
  process.env.NODE_ENV = 'production';

  const origins = resolveAllowedOrigins();

  assert.deepEqual(origins, PRODUCTION_CORS_ORIGINS);
});

test('resolveAllowedOrigins excludes localhost in production even when CORS_ALLOW_LOCAL is set', () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';
  process.env.CORS_ALLOW_LOCAL = 'true';

  const origins = resolveAllowedOrigins();

  assert.deepEqual(origins, PRODUCTION_CORS_ORIGINS);
  assert.equal(
    origins.includes(CLOUDFRONT_FALLBACK_ORIGIN),
    false
  );
  assert.equal(
    origins.includes('http://localhost:5173'),
    false
  );
});

test('resolveAllowedOrigins includes localhost when local mode enabled in development', () => {
  snapshotEnv();
  process.env.CORS_ALLOW_LOCAL = 'true';
  process.env.NODE_ENV = 'development';

  const origins = resolveAllowedOrigins();

  assert.ok(
    origins.includes('http://localhost:5173')
  );
  assert.ok(
    origins.includes(CLOUDFRONT_FALLBACK_ORIGIN)
  );
});

test('production approved primary origin succeeds', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app, {
    origin: 'https://elitewebservices.org',
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://elitewebservices.org'
  );
  assert.equal(response.headers.get('vary'), 'Origin');
});

test('production approved www origin succeeds', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app, {
    origin: 'https://www.elitewebservices.org',
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://www.elitewebservices.org'
  );
  assert.equal(response.headers.get('vary'), 'Origin');
});

test('production evil origin is not reflected', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app, {
    origin: 'https://evil.example.com',
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null
  );
});

test('production CORS_ORIGIN=* does not enable wildcard behavior', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = '*';

  assert.equal(isWildcardCorsEnabled(), false);

  const app = createCorsApp();
  const response = await request(app, {
    origin: 'https://evil.example.com',
  });

  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null
  );
});

test('production OPTIONS from evil origin returns 403', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app, {
    method: 'OPTIONS',
    origin: 'https://evil.example.com',
  });

  assert.equal(response.status, 403);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null
  );
});

test('production OPTIONS from approved origin returns 204', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app, {
    method: 'OPTIONS',
    origin: 'https://www.elitewebservices.org',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers':
        'Authorization, Content-Type, X-Request-Id, X-Correlation-Id',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://www.elitewebservices.org'
  );
  assert.match(
    response.headers.get('access-control-allow-headers') ?? '',
    /Authorization/i
  );
  assert.match(
    response.headers.get('access-control-allow-headers') ?? '',
    /X-Request-Id/i
  );
  assert.match(
    response.headers.get('access-control-allow-headers') ?? '',
    /X-Correlation-Id/i
  );
  assert.match(
    response.headers.get('access-control-expose-headers') ?? '',
    /X-Request-Id/i
  );
  assert.match(
    response.headers.get('access-control-expose-headers') ?? '',
    /X-Correlation-Id/i
  );
});

test('local development explicit wildcard mode works', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'development';
  process.env.CORS_ORIGIN = '*';

  assert.equal(isWildcardCorsEnabled(), true);

  const app = createCorsApp();
  const response = await request(app, {
    origin: 'http://localhost:9999',
  });

  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'http://localhost:9999'
  );
});

test('localhost development origin works when enabled', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'development';

  const app = createCorsApp();
  const response = await request(app, {
    origin: 'http://localhost:5173',
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'http://localhost:5173'
  );
});

test('missing Origin header is allowed', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app);

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null
  );
});

test('Vary: Origin is present for approved production origins', async () => {
  snapshotEnv();
  process.env.NODE_ENV = 'production';

  const app = createCorsApp([...PRODUCTION_CORS_ORIGINS]);
  const response = await request(app, {
    origin: 'https://elitewebservices.org',
  });

  assert.equal(response.headers.get('vary'), 'Origin');
});

test('wildcard CORS is disabled in production even when CORS_ORIGIN=*', () => {
  snapshotEnv();
  delete process.env.CORS_ORIGIN;
  process.env.NODE_ENV = 'production';

  assert.equal(isWildcardCorsEnabled(), false);

  process.env.CORS_ORIGIN = '*';
  assert.equal(isWildcardCorsEnabled(), false);
});

test('wildcard CORS is enabled only in non-production with CORS_ORIGIN=*', () => {
  snapshotEnv();
  process.env.NODE_ENV = 'development';
  process.env.CORS_ORIGIN = '*';

  assert.equal(isWildcardCorsEnabled(), true);
});
