import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIT_EVENTS } from '../../audit';
import { TENANT_ROLES } from '../../auth';
import {
  ACCOUNT_A,
  TENANT_A,
  buildEc2HttpApp,
  emptyInventory,
  httpJson,
  mockClientFactory,
  seedMembership,
  seedVerifiedAccount,
  withHttpServer,
} from '../integration/ec2-discovery-http.helpers';

function captureAudit(): { events: Array<Record<string, unknown>>; restore: () => void } {
  const events: Array<Record<string, unknown>> = [];
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalError = console.error;

  const capture = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        try {
          const parsed = JSON.parse(arg) as Record<string, unknown>;
          if (parsed.category === 'audit') {
            events.push(parsed);
          }
        } catch {
          // ignore
        }
      }
    }
  };

  console.warn = (...args: unknown[]) => {
    capture(...args);
    originalWarn.apply(console, args);
  };
  console.info = (...args: unknown[]) => {
    capture(...args);
    originalInfo.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    capture(...args);
    originalError.apply(console, args);
  };

  return {
    events,
    restore: () => {
      console.warn = originalWarn;
      console.info = originalInfo;
      console.error = originalError;
    },
  };
}

describe('EC2 discovery audit', () => {
  it('emits discovery and resource audit events without credentials', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureAudit();
    const ctx = buildEc2HttpApp(mockClientFactory({ 'us-east-1': emptyInventory() }));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedMembership(ctx.membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    try {
      await withHttpServer(ctx.app, async (baseUrl) => {
        await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
          { userId: 'owner-a', tenantId: TENANT_A },
          {},
        );
        await ctx.ec2Repo.upsertDiscoveredResource({
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          region: 'us-east-1',
          resourceType: 'INSTANCE',
          resourceId: 'i-audit',
          tags: [],
          status: 'ACTIVE',
          metadata: {},
          discoveredAt: '2026-01-01T00:00:00.000Z',
        });
        await httpJson(
          baseUrl,
          'GET',
          `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
          { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
        );
        await httpJson(
          baseUrl,
          'GET',
          `/api/v1/ec2/resources/INSTANCE/i-audit?accountId=${ACCOUNT_A}&region=us-east-1`,
          { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
        );
      });
      const names = audit.events.map((e) => e.eventName);
      assert.ok(names.includes(AUDIT_EVENTS.EC2_DISCOVERY_STARTED));
      assert.ok(names.includes(AUDIT_EVENTS.EC2_DISCOVERY_SUCCEEDED));
      assert.ok(names.includes(AUDIT_EVENTS.EC2_RESOURCE_LISTED));
      assert.ok(names.includes(AUDIT_EVENTS.EC2_RESOURCE_VIEWED));
      assert.doesNotMatch(JSON.stringify(audit.events), /fake-secret/);
    } finally {
      audit.restore();
    }
  });

  it('emits discovery_partial and discovery_failed audit events', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureAudit();
    const partialErr = new Error('denied');
    partialErr.name = 'AccessDenied';
    const ctx = buildEc2HttpApp(
      mockClientFactory({ 'us-east-1': emptyInventory() }, { 'us-west-2': partialErr }),
    );
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    const failCtx = buildEc2HttpApp(mockClientFactory({}, { 'us-east-1': partialErr }));
    await seedMembership(failCtx.membershipRepository, TENANT_A, 'owner-b', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(failCtx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    try {
      await withHttpServer(ctx.app, async (baseUrl) => {
        await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
          { userId: 'owner-a', tenantId: TENANT_A },
          { regions: ['us-east-1', 'us-west-2'] },
        );
      });
      await withHttpServer(failCtx.app, async (baseUrl) => {
        await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
          { userId: 'owner-b', tenantId: TENANT_A },
          {},
        );
      });
      const names = audit.events.map((e) => e.eventName);
      assert.ok(names.includes(AUDIT_EVENTS.EC2_DISCOVERY_PARTIAL));
      assert.ok(names.includes(AUDIT_EVENTS.EC2_DISCOVERY_FAILED));
      assert.doesNotMatch(JSON.stringify(audit.events), /ext-test-value-never-logged/);
    } finally {
      audit.restore();
    }
  });
});
