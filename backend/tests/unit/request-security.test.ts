import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import {
  createJsonBodyParser,
  createJsonErrorHandler,
  DEFAULT_JSON_BODY_LIMIT,
} from '../../security/request-limits';
import {
  validatePaginationToken,
  validateRegion,
  validateReportGenerateBody,
  validateReportQueryLimit,
  validateResourceId,
  validateWorkflowRunBody,
} from '../../security/request-validation';
import { AppError } from '../../shared/utils';

function createJsonApp() {
  const app = express();

  app.use(createJsonBodyParser());
  app.use(createJsonErrorHandler());
  app.post('/echo', (req, res) => {
    res.json({ received: req.body });
  });

  return app;
}

async function postJson(
  app: express.Application,
  body: string,
  headers?: Record<string, string>
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
      `http://127.0.0.1:${address.port}/echo`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body,
      }
    );

    const parsed = (await response.json()) as Record<
      string,
      unknown
    >;

    return {
      status: response.status,
      body: parsed,
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

test('default JSON body limit is 256kb', () => {
  assert.equal(DEFAULT_JSON_BODY_LIMIT, '256kb');
});

test('malformed JSON returns structured 400 response', async () => {
  const response = await postJson(createJsonApp(), '{invalid');

  assert.equal(response.status, 400);
  assert.equal(
    (response.body.error as { code: string }).code,
    'INVALID_JSON'
  );
});

test('oversized JSON returns structured 413 response', async () => {
  const app = express();
  app.use(createJsonBodyParser('32b'));
  app.use(createJsonErrorHandler());
  app.post('/echo', (req, res) => {
    res.json({ received: req.body });
  });

  const response = await postJson(
    app,
    JSON.stringify({ payload: 'x'.repeat(256) })
  );

  assert.equal(response.status, 413);
  assert.equal(
    (response.body.error as { code: string }).code,
    'PAYLOAD_TOO_LARGE'
  );
});

test('validateWorkflowRunBody rejects unsupported plugins', () => {
  assert.throws(
    () =>
      validateWorkflowRunBody(
        { plugin: 'rds', mode: 'full' },
        'us-east-1'
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'PLUGIN_NOT_FOUND'
  );
});

test('validateWorkflowRunBody rejects invalid modes', () => {
  assert.throws(
    () =>
      validateWorkflowRunBody(
        { plugin: 'ec2', mode: 'live' },
        'us-east-1'
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_REQUEST'
  );
});

test('validateWorkflowRunBody rejects invalid region format', () => {
  assert.throws(
    () =>
      validateWorkflowRunBody(
        {
          plugin: 'ec2',
          mode: 'full',
          region: 'invalid-region',
        },
        'us-east-1'
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.message.includes('region')
  );
});

test('validateResourceId rejects overly long identifiers', () => {
  assert.throws(
    () => validateResourceId('i-' + 'a'.repeat(200)),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_REQUEST'
  );
});

test('validateReportGenerateBody requires workflowId', () => {
  assert.throws(
    () => validateReportGenerateBody({}),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_REQUEST'
  );
});

test('validateReportQueryLimit enforces maximum', () => {
  assert.equal(validateReportQueryLimit('10', 50, 100), 10);
  assert.equal(validateReportQueryLimit('500', 50, 100), 100);
});

test('validatePaginationToken rejects malformed tokens', () => {
  assert.throws(
    () => validatePaginationToken('bad token!'),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_REQUEST'
  );
});

test('validateRegion accepts standard AWS regions', () => {
  assert.equal(validateRegion('us-east-1'), 'us-east-1');
});
