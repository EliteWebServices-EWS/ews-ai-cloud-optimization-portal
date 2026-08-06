import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { after, describe, it } from 'node:test';

import { AUDIT_EVENTS } from '../../audit';
import { createEc2SecurityRoutes } from '../../api/routes/ec2-security.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
  type TenantRole,
} from '../../auth';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import {
  Ec2SecurityAnalysisApiService,
  type StartEc2SecurityAnalysisInput,
} from '../../services/ec2-security-analysis-api-service';
import { AppError } from '../../shared/utils';
import {
  assertNoSensitiveFields,
} from './ec2-cost-api-http.helpers';
import {
  httpJson,
  seedMembership,
  seedVerifiedAccount,
  type TestIdentity,
} from './ec2-discovery-http.helpers';

const TENANT_A = 'tenant-sec-audit';
const TENANT_B = 'tenant-sec-audit-b';
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '222233334444';
const ANALYSIS_PATH = '/api/v1/analysis/ec2/security';

function groupsForRole(role: TenantRole): string {
  if (role === TENANT_ROLES.ANALYST) {
    return 'analyst';
  }
  if (role === TENANT_ROLES.VIEWER || role === TENANT_ROLES.AUDITOR) {
    return 'viewer';
  }
  return 'admin';
}

function identity(tenantId: string, role: TenantRole, userId: string): TestIdentity {
  return {
    tenantId,
    userId,
    authenticated: true,
    groups: [groupsForRole(role)],
  };
}

function captureSecurityAudit(): { events: string[]; restore: () => void } {
  const auditEvents: string[] = [];
  const originalInfo = console.info;
  const originalErr = console.error;
  const originalWarn = console.warn;
  const capture = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        try {
          const parsed = JSON.parse(arg) as { category?: string };
          if (parsed.category === 'audit') {
            auditEvents.push(arg);
          }
        } catch {
          // ignore
        }
      }
    }
  };
  console.info = (...args: unknown[]) => {
    capture(...args);
    originalInfo.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    capture(...args);
    originalErr.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    capture(...args);
    originalWarn.apply(console, args);
  };
  return {
    events: auditEvents,
    restore: () => {
      console.info = originalInfo;
      console.error = originalErr;
      console.warn = originalWarn;
    },
  };
}

function parseAuditLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function countNamed(events: Array<Record<string, unknown>>, eventName: string): number {
  return events.filter((event) => event.eventName === eventName).length;
}

function createSecurityTestApp(
  service: Ec2SecurityAnalysisApiService,
  membershipRepository: InMemoryMembershipRepository,
): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
  app.use(requireTenantContext());
  app.use(
    '/api/v1',
    createEc2SecurityRoutes({
      ec2SecurityAnalysisApi: service,
      membershipRepository,
    }),
  );
  return app;
}

async function withServer<T>(
  app: express.Application,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

class OrchestratorFailureService extends Ec2SecurityAnalysisApiService {
  override async startSecurityAnalysis(
    _tenantId: string,
    _input: StartEc2SecurityAnalysisInput,
  ): Promise<never> {
    throw Object.assign(new Error('orchestrator-secret-boom'), { name: 'InternalFailure' });
  }
}

class MappedOrchestratorFailureService extends Ec2SecurityAnalysisApiService {
  override async startSecurityAnalysis(
    _tenantId: string,
    _input: StartEc2SecurityAnalysisInput,
  ): Promise<never> {
    throw new AppError('EC2_SECURITY_UNAVAILABLE', 'secret-engine-message', 503);
  }
}

describe('EC2 security analysis audit ordering', () => {
  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  it('422 invalid body emits no analysis_started', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      const awsAccounts = new MockAwsAccountRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'invalid-body',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = createSecurityTestApp(service, membershipRepository);
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'invalid-body');
      await withServer(app, async (baseUrl) => {
        const { status } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: ACCOUNT_A,
          inventory: [],
        });
        assert.equal(status, 422);
      });
      const events = parseAuditLines(audit.events);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED), 0);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED), 0);
    } finally {
      audit.restore();
    }
  });

  it('404 missing account emits no analysis_started', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      const awsAccounts = new MockAwsAccountRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'missing-acct',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = createSecurityTestApp(service, membershipRepository);
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'missing-acct');
      await withServer(app, async (baseUrl) => {
        const { status } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: '999988887777',
        });
        assert.equal(status, 404);
      });
      const events = parseAuditLines(audit.events);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED), 0);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED), 0);
    } finally {
      audit.restore();
    }
  });

  it('404 cross-tenant account emits no analysis_started', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      const awsAccounts = new MockAwsAccountRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      await seedVerifiedAccount(awsAccounts, TENANT_B, ACCOUNT_B, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'cross-tenant',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = createSecurityTestApp(service, membershipRepository);
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'cross-tenant');
      await withServer(app, async (baseUrl) => {
        const { status } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: ACCOUNT_B,
        });
        assert.equal(status, 404);
      });
      const events = parseAuditLines(audit.events);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED), 0);
    } finally {
      audit.restore();
    }
  });

  it('409 unverified account emits no analysis_started', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      const awsAccounts = new MockAwsAccountRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      await awsAccounts.create({
        tenantId: TENANT_A,
        accountId: '333344445555',
        roleArn: 'arn:aws:iam::333344445555:role/SisumReadOnlyIntegrationRole',
        externalId: 'ext-test-value-never-logged',
        region: 'us-east-1',
        status: 'PENDING',
        verificationStatus: 'NOT_STARTED',
        metadata: {},
      });
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'unverified',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = createSecurityTestApp(service, membershipRepository);
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'unverified');
      await withServer(app, async (baseUrl) => {
        const { status } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: '333344445555',
        });
        assert.equal(status, 409);
      });
      const events = parseAuditLines(audit.events);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED), 0);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED), 0);
    } finally {
      audit.restore();
    }
  });

  it('403 forbidden does not emit analysis_started', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      const awsAccounts = new MockAwsAccountRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(membershipRepository, TENANT_A, 'viewer-user', TENANT_ROLES.VIEWER);
      const app = createSecurityTestApp(service, membershipRepository);
      const id = identity(TENANT_A, TENANT_ROLES.VIEWER, 'viewer-user');
      await withServer(app, async (baseUrl) => {
        const { status } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: ACCOUNT_A,
        });
        assert.equal(status, 403);
      });
      const events = parseAuditLines(audit.events);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED), 0);
      assert.ok(
        events.some((event) => event.eventName === 'authorization.denied'),
        'expected authorization.denied audit',
      );
    } finally {
      audit.restore();
    }
  });

  it('verified account emits exactly one analysis_started', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'one-started',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = express();
      app.use(express.json());
      app.use(createIdentitySourceMiddleware('lambda-adapter'));
      app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
      app.use(requireTenantContext());
      app.use(
        '/api/v1',
        createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
      );
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'one-started');
      await withServer(app, async (baseUrl) => {
        const { status } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: ACCOUNT_A,
          regions: ['us-east-1'],
        });
        assert.equal(status, 200);
      });
      const events = parseAuditLines(audit.events);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED), 1);
    } finally {
      audit.restore();
    }
  });

  it('successful run emits started then succeeded', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'success-chain',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = express();
      app.use(express.json());
      app.use(createIdentitySourceMiddleware('lambda-adapter'));
      app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
      app.use(requireTenantContext());
      app.use(
        '/api/v1',
        createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
      );
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'success-chain');
      await withServer(app, async (baseUrl) => {
        assert.equal(
          (await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, { accountId: ACCOUNT_A })).status,
          200,
        );
      });
      const events = parseAuditLines(audit.events);
      const names = events.map((event) => event.eventName);
      const startedIdx = names.indexOf(AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED);
      const succeededIdx = names.indexOf(AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_SUCCEEDED);
      assert.ok(startedIdx >= 0);
      assert.ok(succeededIdx > startedIdx);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED), 0);
    } finally {
      audit.restore();
    }
  });

  it('partial run emits started then partial', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      await resources.upsertDiscoveredResource({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        region: 'us-east-1',
        resourceType: 'INSTANCE',
        resourceId: 'i-prefix-partial',
        tags: [],
        status: 'ACTIVE',
        metadata: {
          instanceType: 't3.micro',
          state: 'running',
          metadataHttpTokens: 'required',
          monitoringState: 'enabled',
          launchTime: new Date().toISOString(),
          securityGroups: [
            {
              groupId: 'sg-pl',
              inboundRules: [
                {
                  protocol: 'tcp',
                  fromPort: 22,
                  toPort: 22,
                  prefixListIds: ['pl-ssh'],
                },
              ],
            },
          ],
        },
        discoveredAt: new Date().toISOString(),
      });
      const securityRepo = new MockEc2SecurityRepository();
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'partial-chain',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = express();
      app.use(express.json());
      app.use(createIdentitySourceMiddleware('lambda-adapter'));
      app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
      app.use(requireTenantContext());
      app.use(
        '/api/v1',
        createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
      );
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'partial-chain');
      await withServer(app, async (baseUrl) => {
        const { status, body } = await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, {
          accountId: ACCOUNT_A,
          regions: ['us-east-1'],
        });
        assert.equal(status, 200);
        const data = (body.data as Record<string, unknown>) ?? {};
        assert.equal(data.instancesAnalyzed, 1);
        assert.ok(Array.isArray(data.warnings) && (data.warnings as unknown[]).length > 0);
      });
      const events = parseAuditLines(audit.events);
      const names = events.map((event) => event.eventName);
      const startedIdx = names.indexOf(AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED);
      const partialIdx = names.indexOf(AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_PARTIAL);
      assert.ok(startedIdx >= 0);
      assert.ok(partialIdx > startedIdx);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_SUCCEEDED), 0);
    } finally {
      audit.restore();
    }
  });

  it('orchestrator failure emits started then failed', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new OrchestratorFailureService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'fail-chain',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = express();
      app.use(express.json());
      app.use(createIdentitySourceMiddleware('lambda-adapter'));
      app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
      app.use(requireTenantContext());
      app.use(
        '/api/v1',
        createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
      );
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'fail-chain');
      await withServer(app, async (baseUrl) => {
        assert.equal(
          (await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, { accountId: ACCOUNT_A })).status,
          500,
        );
      });
      const events = parseAuditLines(audit.events);
      const names = events.map((event) => event.eventName);
      const startedIdx = names.indexOf(AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_STARTED);
      const failedIdx = names.lastIndexOf(AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED);
      assert.ok(startedIdx >= 0);
      assert.ok(failedIdx > startedIdx);
      assert.equal(countNamed(events, AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_SUCCEEDED), 0);
      assert.doesNotMatch(audit.events.join('\n'), /orchestrator-secret-boom/);
    } finally {
      audit.restore();
    }
  });

  it('does not emit both succeeded and failed for one request', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'terminal-one',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = createSecurityTestApp(service, membershipRepository);
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'terminal-one');
      await withServer(app, async (baseUrl) => {
        await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, { accountId: ACCOUNT_A });
      });
      const events = parseAuditLines(audit.events);
      const terminal = events.filter((event) => {
        const name = event.eventName;
        return (
          name === AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_SUCCEEDED ||
          name === AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED ||
          name === AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_PARTIAL
        );
      });
      assert.equal(terminal.length, 1);
    } finally {
      audit.restore();
    }
  });

  it('failure audit statusCode matches HTTP mapping', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const securityRepo = new MockEc2SecurityRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      const service = new MappedOrchestratorFailureService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'status-map',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = express();
      app.use(express.json());
      app.use(createIdentitySourceMiddleware('lambda-adapter'));
      app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
      app.use(requireTenantContext());
      app.use(
        '/api/v1',
        createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
      );
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'status-map');
      await withServer(app, async (baseUrl) => {
        assert.equal(
          (await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, { accountId: ACCOUNT_A })).status,
          503,
        );
      });
      const failed = parseAuditLines(audit.events).find(
        (event) => event.eventName === AUDIT_EVENTS.EC2_SECURITY_ANALYSIS_FAILED,
      );
      assert.ok(failed);
      assert.equal(failed.statusCode, 503);
      assert.equal(failed.errorCode, 'EC2_SECURITY_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(failed), /secret-engine-message/);
    } finally {
      audit.restore();
    }
  });

  it('audit payload excludes inventory, ingress, credentials, and raw errors', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const audit = captureSecurityAudit();
    try {
      const awsAccounts = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
      await resources.upsertDiscoveredResource({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        region: 'us-east-1',
        resourceType: 'INSTANCE',
        resourceId: 'i-audit-sanitize',
        tags: [],
        status: 'ACTIVE',
        metadata: {
          instanceType: 't3.micro',
          state: 'running',
          publicIpAddress: '198.51.100.99',
          metadataHttpTokens: 'optional',
          securityGroups: [
            {
              groupId: 'sg-secret',
              inboundRules: [{ protocol: 'tcp', fromPort: 22, toPort: 22, cidr: '0.0.0.0/0' }],
            },
          ],
        },
        discoveredAt: new Date().toISOString(),
      });
      const securityRepo = new MockEc2SecurityRepository();
      const service = new Ec2SecurityAnalysisApiService(
        awsAccounts,
        resources,
        securityRepo,
        securityRepo,
        securityRepo,
      );
      const membershipRepository = new InMemoryMembershipRepository();
      await seedMembership(
        membershipRepository,
        TENANT_A,
        'sanitize',
        TENANT_ROLES.SECURITY_ADMIN,
      );
      const app = express();
      app.use(express.json());
      app.use(createIdentitySourceMiddleware('lambda-adapter'));
      app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
      app.use(requireTenantContext());
      app.use(
        '/api/v1',
        createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
      );
      const id = identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'sanitize');
      await withServer(app, async (baseUrl) => {
        await httpJson(baseUrl, 'POST', ANALYSIS_PATH, id, { accountId: ACCOUNT_A });
      });
      const blob = audit.events.join('\n');
      assert.doesNotMatch(blob, /0\.0\.0\.0\/0/);
      assert.doesNotMatch(blob, /198\.51\.100\.99/);
      assert.doesNotMatch(blob, /orchestrator-secret-boom/);
      for (const line of audit.events) {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (
          typeof event.eventName === 'string' &&
          event.eventName.startsWith('ec2.security_analysis')
        ) {
          assertNoSensitiveFields(event);
        }
      }
    } finally {
      audit.restore();
    }
  });
});
