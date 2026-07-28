import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTestApp,
  httpRequest,
  identityHeaders,
  seedActiveTenant,
  TENANT_A,
  USER_PLATFORM_ADMIN,
  USER_TENANT_A_OWNER,
} from './fixtures';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index]!;
}

describe('Tenant administration performance validation (informational)', () => {
  it('records latency samples for representative operations', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'perf-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    const samples: number[] = [];
    const iterations = 20;

    for (let index = 0; index < 5; index += 1) {
      await httpRequest(ctx.app, 'GET', `/api/v1/admin/tenants/${TENANT_A}`, {
        headers: identityHeaders({
          userId: USER_TENANT_A_OWNER,
          groups: ['admin'],
          tenantId: TENANT_A,
        }),
      });
    }

    for (let index = 0; index < iterations; index += 1) {
      const start = performance.now();
      await httpRequest(ctx.app, 'GET', `/api/v1/admin/tenants/${TENANT_A}`, {
        headers: identityHeaders({
          userId: USER_TENANT_A_OWNER,
          groups: ['admin'],
          tenantId: TENANT_A,
        }),
      });
      samples.push(performance.now() - start);
    }

    samples.sort((left, right) => left - right);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;

    const stats = {
      sampleCount: samples.length,
      minMs: samples[0],
      meanMs: mean,
      p50Ms: percentile(samples, 50),
      p95Ms: percentile(samples, 95),
      p99Ms: percentile(samples, 99),
      maxMs: samples[samples.length - 1],
    };

    assert.equal(stats.sampleCount, iterations);
    assert.ok(stats.meanMs >= 0);
    assert.ok(stats.p95Ms >= stats.p50Ms);

    process.stdout.write(
      `[sprint12-perf] tenant-get local samples=${JSON.stringify(stats)}\n`,
    );
  });

  it('measures tenant create with session MFA claim (single sample)', async () => {
    const ctx = buildTestApp();
    const start = performance.now();

    const response = await httpRequest(ctx.app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: {
        organizationName: 'Perf Org',
        displayName: 'Perf',
        slug: `perf-${Date.now()}`,
        ownerUserId: USER_TENANT_A_OWNER,
        primaryContact: { name: 'Perf', email: 'perf@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    });

    const elapsedMs = performance.now() - start;
    assert.equal(response.status, 201);
    assert.ok(elapsedMs >= 0);
  });
});
