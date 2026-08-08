import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import http from 'node:http';
import { createEc2SecurityRoutes } from '../../api/routes/ec2-security.routes';
import { ALL_AUTHENTICATED_ROLES, createIdentitySourceMiddleware, requireAnyRole, requireTenantContext } from '../../auth';

let server: http.Server;
let baseUrl: string;
const headers = { 'content-type': 'application/json', 'x-sisum-authenticated': 'true', 'x-sisum-token-use': 'access', 'x-sisum-client-id': 'test-client', 'x-sisum-user-id': 'security-analyst', 'x-sisum-user-email': 'security@example.com', 'x-sisum-user-groups': 'analyst', 'x-sisum-tenant-id': 'tenant-security' };

before(async () => {
  const app = express(); app.use(express.json()); app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use('/api/v1', requireAnyRole(...ALL_AUTHENTICATED_ROLES), requireTenantContext(), createEc2SecurityRoutes());
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as { port: number }; baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe('EC2 security analysis API', () => {
  it('analyzes inventory and returns recommendations', async () => {
    const analysis = await fetch(`${baseUrl}/analysis/ec2/security`, { method: 'POST', headers, body: JSON.stringify({ inventory: [{ instanceId: 'i-api-risk', instanceType: 'm5.large', tags: {}, ebsVolumes: [{ encrypted: false }], metadataHttpTokens: 'optional', cloudWatchMonitoring: false, backupPolicy: { enabled: false } }] }) });
    assert.equal(analysis.status, 200);
    const body = await analysis.json() as { success: boolean; data: { summary: { instancesAnalyzed: number; riskLevel: string } } };
    assert.equal(body.success, true); assert.equal(body.data.summary.instancesAnalyzed, 1); assert.equal(body.data.summary.riskLevel, 'high');
    const recommendations = await fetch(`${baseUrl}/recommendations/ec2/security`, { headers });
    assert.equal(recommendations.status, 200);
    const recommendationBody = await recommendations.json() as { data: { recommendations: unknown[] } };
    assert.ok(recommendationBody.data.recommendations.length > 0);
  });

  it('rejects malformed inventory', async () => {
    const response = await fetch(`${baseUrl}/analysis/ec2/security`, { method: 'POST', headers, body: JSON.stringify({ inventory: [{}] }) });
    assert.equal(response.status, 400);
  });
});
