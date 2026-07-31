import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { buildPlanInput, TENANT_A, TENANT_B } from './execution/fixtures';
import { initialApprovalStatus } from '../../repositories/contracts/execution-plan-repository';
import {
  analystIdentity,
  buildPlanBody,
  createExecutionHttpApp,
  createHttpContext,
  createPlanViaHttp,
  httpGet,
  httpJson,
  prepareApprovedPlan,
  prepareExecutedPlan,
  privilegedIdentity,
  seedSecurityAdmin,
  seedTenantOwner,
  submitForApproval,
  withHttpServer,
} from './execution-api/http-fixtures';

describe('Execution API HTTP integration', () => {
  const previousProductionFlag = process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
  const previousProviderMode = process.env.PROVIDER_MODE;

  before(() => {
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
    process.env.PROVIDER_MODE = 'aws';
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  });

  after(() => {
    if (previousProductionFlag === undefined) {
      delete process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
    } else {
      process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = previousProductionFlag;
    }
    if (previousProviderMode === undefined) {
      delete process.env.PROVIDER_MODE;
    } else {
      process.env.PROVIDER_MODE = previousProviderMode;
    }
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  describe('POST /api/v1/execution/plans', () => {
    it('creates a plan for an authorized caller with 201', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);
      const identity = analystIdentity();

      await withHttpServer(app, async (baseUrl) => {
        const response = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/execution/plans',
          identity,
          buildPlanBody(),
        );
        assert.equal(response.status, 201);
        const data = response.body.data as Record<string, unknown>;
        assert.equal(data.tenantId, TENANT_A);
        assert.equal(data.planStatus, 'DRAFT');
      });
    });

    it('rejects tenantId in the create body (trusted tenant context only)', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const response = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/execution/plans',
          analystIdentity(),
          buildPlanBody({ tenantId: TENANT_B }),
        );
        assert.equal(response.status, 422);
        assert.match(
          String((response.body.error as Record<string, unknown>).message),
          /tenantId must not be supplied/i,
        );
      });
    });

    it('returns validation error for malformed create body', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const response = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/execution/plans',
          analystIdentity(),
          { workflowId: '' },
        );
        assert.equal(response.status, 422);
        assert.equal((response.body.error as Record<string, unknown>).code, 'INVALID_REQUEST');
      });
    });
  });

  describe('GET /api/v1/execution/plans/:planId', () => {
    it('retrieves a tenant-scoped plan', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId } = await createPlanViaHttp(baseUrl, analystIdentity());
        const response = await httpGet(
          baseUrl,
          `/api/v1/execution/plans/${planId}`,
          analystIdentity(),
        );
        assert.equal(response.status, 200);
        assert.equal((response.body.data as Record<string, unknown>).planId, planId);
      });
    });

    it('returns 404 for unknown plan', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const response = await httpGet(
          baseUrl,
          '/api/v1/execution/plans/missing-plan',
          analystIdentity(),
        );
        assert.equal(response.status, 404);
      });
    });

    it('returns safe 404 for cross-tenant plan access', async () => {
      const ctx = createHttpContext();
      await ctx.stores.plans.create(
        buildPlanInput({
          executionId: 'exec-cross-http',
          tenantId: TENANT_B,
          approvalRequired: true,
          approvalStatus: initialApprovalStatus(true),
        }),
      );
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const response = await httpGet(
          baseUrl,
          '/api/v1/execution/plans/exec-cross-http',
          analystIdentity('reader-1', TENANT_A),
        );
        assert.equal(response.status, 404);
      });
    });
  });

  describe('PATCH /api/v1/execution/plans/:planId', () => {
    it('updates an allowed metadata field', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const response = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/execution/plans/${planId}`,
          analystIdentity(),
          { expectedVersion: version, metadata: { note: 'updated' } },
        );
        assert.equal(response.status, 200);
        const data = response.body.data as Record<string, unknown>;
        assert.deepEqual(data.metadata, { note: 'updated' });
      });
    });

    it('requires expectedVersion', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId } = await createPlanViaHttp(baseUrl, analystIdentity());
        const response = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/execution/plans/${planId}`,
          analystIdentity(),
          { metadata: { note: 'x' } },
        );
        assert.equal(response.status, 422);
      });
    });

    it('returns 409 for stale expectedVersion on PATCH', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const first = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/execution/plans/${planId}`,
          analystIdentity(),
          { expectedVersion: version, metadata: { note: 'first' } },
        );
        assert.equal(first.status, 200);
        const stale = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/execution/plans/${planId}`,
          analystIdentity(),
          { expectedVersion: version, metadata: { note: 'stale' } },
        );
        assert.equal(stale.status, 409);
      });
    });

    it('rejects immutable lifecycle fields', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const response = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/execution/plans/${planId}`,
          analystIdentity(),
          { expectedVersion: version, planStatus: 'APPROVED' },
        );
        assert.equal(response.status, 422);
      });
    });
  });

  describe('POST approve / reject', () => {
    it('allows privileged tenant owner with MFA to approve', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const approver = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, creator, approver);
        assert.equal(approved.planStatus, 'APPROVED');
      });
    });

    it('returns 403 for unauthorized analyst role on approve', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const pending = await submitForApproval(baseUrl, analystIdentity(), planId, version);
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/approve`,
          { ...analystIdentity('analyst-priv'), sessionMfaVerified: true },
          { expectedVersion: pending.version },
        );
        assert.equal(response.status, 403);
      });
    });

    it('returns 403 when privileged MFA evidence is missing', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const pending = await submitForApproval(baseUrl, analystIdentity(), planId, version);
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/approve`,
          privilegedIdentity('owner-a', TENANT_A, false),
          { expectedVersion: pending.version },
        );
        assert.equal(response.status, 403);
      });
    });

    it('returns 409 when approving from DRAFT without submission', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/approve`,
          privilegedIdentity('owner-a'),
          { expectedVersion: version },
        );
        assert.equal(response.status, 409);
      });
    });

    it('returns 409 for stale expectedVersion on approve', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        await submitForApproval(baseUrl, analystIdentity(), planId, version);
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/approve`,
          privilegedIdentity('owner-a'),
          { expectedVersion: 1 },
        );
        assert.equal(response.status, 409);
      });
    });

    it('returns safe 404 for cross-tenant approval', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const pending = await submitForApproval(baseUrl, analystIdentity(), planId, version);
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/approve`,
          privilegedIdentity('owner-b', TENANT_B),
          { expectedVersion: pending.version },
        );
        assert.equal(response.status, 404);
      });
    });

    it('rejects a pending plan and blocks wrong lifecycle with 409', async () => {
      const ctx = createHttpContext();
      await seedSecurityAdmin(ctx);
      const app = createExecutionHttpApp(ctx);
      const approver = privilegedIdentity('sec-admin-a');

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const rejectDraft = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/reject`,
          approver,
          { expectedVersion: version, rejectionReason: 'too early' },
        );
        assert.equal(rejectDraft.status, 409);

        const pending = await submitForApproval(baseUrl, analystIdentity(), planId, version);
        const rejected = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/reject`,
          approver,
          { expectedVersion: pending.version, rejectionReason: 'no' },
        );
        assert.equal(rejected.status, 200);
        assert.equal((rejected.body.data as Record<string, unknown>).planStatus, 'REJECTED');
      });
    });

    it('returns 403 for unauthorized reject', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const pending = await submitForApproval(baseUrl, analystIdentity(), planId, version);
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/reject`,
          { ...analystIdentity(), sessionMfaVerified: true },
          { expectedVersion: pending.version },
        );
        assert.equal(response.status, 403);
      });
    });
  });

  describe('POST execute', () => {
    it('executes an approved plan when production is enabled', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const executor = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, creator, executor);
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          executor,
          { expectedVersion: approved.version },
        );
        assert.equal(response.status, 200);
        const data = response.body.data as Record<string, unknown>;
        assert.equal(data.orchestrationStatus, 'SUCCEEDED');
        assert.ok(ctx.awsSendCount.value > 0);
      });
    });

    it('returns 409 when plan is not approved', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/execute`,
          privilegedIdentity('owner-a'),
          { expectedVersion: version },
        );
        assert.equal(response.status, 409);
      });
    });

    it('fails closed when production execution is disabled without mutating AWS', async () => {
      process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'false';
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const executor = privilegedIdentity('owner-a');

      try {
        await withHttpServer(app, async (baseUrl) => {
          const approved = await prepareApprovedPlan(baseUrl, creator, executor);
          const before = await ctx.stores.plans.getById(TENANT_A, approved.planId);
          assert.ok(before);
          assert.equal(before.planStatus, 'APPROVED');

          const response = await httpJson(
            baseUrl,
            'POST',
            `/api/v1/execution/plans/${approved.planId}/execute`,
            executor,
            { expectedVersion: approved.version },
          );
          assert.equal(response.status, 422);
          assert.equal(
            (response.body.error as Record<string, unknown>).code,
            'EXECUTION_PRODUCTION_DISABLED',
          );

          const after = await ctx.stores.plans.getById(TENANT_A, approved.planId);
          assert.ok(after);
          assert.equal(after.planStatus, 'APPROVED');
          assert.equal(ctx.awsSendCount.value, 0);
          const runs = await ctx.stores.runs.listByTenant(TENANT_A, {});
          assert.equal(runs.items.length, 0);
        });
      } finally {
        process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
      }
    });

    it('returns 403 for unauthorized execute and missing MFA', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const executor = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, creator, executor);
        const forbidden = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          analystIdentity(),
          { expectedVersion: approved.version },
        );
        assert.equal(forbidden.status, 403);

        const noMfa = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          privilegedIdentity('owner-a', TENANT_A, false),
          { expectedVersion: approved.version },
        );
        assert.equal(noMfa.status, 403);
      });
    });
  });

  describe('POST rollback', () => {
    it('rolls back an eligible completed execution', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const privileged = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, creator, privileged);
        const executed = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          privileged,
          { expectedVersion: approved.version },
        );
        assert.equal(executed.status, 200);

        const latest = await httpGet(
          baseUrl,
          `/api/v1/execution/plans/${approved.planId}`,
          analystIdentity(),
        );
        const currentVersion = Number(
          (latest.body.data as Record<string, unknown>).version,
        );

        const rollback = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/rollback`,
          privileged,
          { expectedVersion: currentVersion },
        );
        if (rollback.status !== 200) {
          throw new Error(
            `rollback failed: ${rollback.status} ${JSON.stringify(rollback.body)}`,
          );
        }
        assert.equal(rollback.status, 200);
        assert.equal(
          (rollback.body.data as Record<string, unknown>).orchestrationStatus,
          'ROLLED_BACK',
        );
      });
    });

    it('returns 409 for duplicate rollback without calling the adapter again', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const privileged = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const executed = await prepareExecutedPlan(baseUrl, creator, privileged);
        const sendsBefore = ctx.awsSendCount.value;
        const first = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${executed.planId}/rollback`,
          privileged,
          { expectedVersion: executed.version },
        );
        assert.equal(first.status, 200);
        assert.equal(
          (first.body.data as Record<string, unknown>).orchestrationStatus,
          'ROLLED_BACK',
        );
        const sendsAfterFirst = ctx.awsSendCount.value;
        assert.ok(sendsAfterFirst > sendsBefore);

        const latest = await httpGet(
          baseUrl,
          `/api/v1/execution/plans/${executed.planId}`,
          creator,
        );
        const duplicate = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${executed.planId}/rollback`,
          privileged,
          { expectedVersion: Number((latest.body.data as Record<string, unknown>).version) },
        );
        assert.equal(duplicate.status, 409);
        assert.equal(
          (duplicate.body.error as Record<string, unknown>).code,
          'CONFLICT',
        );
        assert.match(
          String((duplicate.body.error as Record<string, unknown>).message),
          /already rolled back/i,
        );
        assert.equal(ctx.awsSendCount.value, sendsAfterFirst);
      });
    });

    it('returns 409 for ineligible rollback on draft plan', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
        const ineligible = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${planId}/rollback`,
          privilegedIdentity('owner-a'),
          { expectedVersion: version },
        );
        assert.equal(ineligible.status, 409);
      });
    });

    it('rejects unauthorized and cross-tenant rollback', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const creator = analystIdentity();
      const privileged = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, creator, privileged);
        const executed = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          privileged,
          { expectedVersion: approved.version },
        );
        const plan = (executed.body.data as Record<string, unknown>).plan as Record<
          string,
          unknown
        >;

        const forbidden = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/rollback`,
          analystIdentity(),
          { expectedVersion: plan.version },
        );
        assert.equal(forbidden.status, 403);

        const crossTenant = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/rollback`,
          privilegedIdentity('owner-b', TENANT_B),
          { expectedVersion: plan.version },
        );
        assert.equal(crossTenant.status, 404);
      });
    });
  });

  describe('GET status and plan listing', () => {
    it('returns sanitized status without internal storage keys', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const privileged = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, analystIdentity(), privileged);
        await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          privileged,
          { expectedVersion: approved.version },
        );

        const response = await httpGet(
          baseUrl,
          `/api/v1/execution/plans/${approved.planId}/status`,
          analystIdentity(),
        );
        assert.equal(response.status, 200);
        const serialized = JSON.stringify(response.body);
        assert.doesNotMatch(serialized, /\bPK\b|\bSK\b|awsRequest|awsResponse|stack/i);
        const data = response.body.data as Record<string, unknown>;
        assert.ok('planStatus' in data);
        assert.ok(!('executionSteps' in data));
      });
    });

    it('lists tenant-scoped plans with filters, pagination, and validation', async () => {
      const ctx = createHttpContext();
      const app = createExecutionHttpApp(ctx);

      await withHttpServer(app, async (baseUrl) => {
        await createPlanViaHttp(baseUrl, analystIdentity(), { workflowId: 'wf-list-a' });
        await createPlanViaHttp(baseUrl, analystIdentity(), { workflowId: 'wf-list-b' });

        const page = await httpGet(
          baseUrl,
          '/api/v1/execution/plans?limit=1',
          analystIdentity(),
        );
        assert.equal(page.status, 200);
        const pageData = page.body.data as Record<string, unknown>;
        const items = pageData.items as unknown[];
        assert.equal(items.length, 1);
        assert.ok(pageData.nextToken);

        const badToken = await httpGet(
          baseUrl,
          `/api/v1/execution/plans?nextToken=${encodeURIComponent('not-a-token')}`,
          analystIdentity(),
        );
        assert.equal(badToken.status, 422);

        if (typeof pageData.nextToken === 'string') {
          const crossTenantToken = await httpGet(
            baseUrl,
            `/api/v1/execution/plans?nextToken=${encodeURIComponent(pageData.nextToken)}`,
            analystIdentity('reader-b', TENANT_B),
          );
          assert.equal(crossTenantToken.status, 422);
        }

        const statusFilter = await httpGet(
          baseUrl,
          '/api/v1/execution/plans?status=DRAFT',
          analystIdentity(),
        );
        assert.equal(statusFilter.status, 200);
        assert.ok((statusFilter.body.data as Record<string, unknown>).items);

        const badStatus = await httpGet(
          baseUrl,
          '/api/v1/execution/plans?status=NOT_A_STATUS',
          analystIdentity(),
        );
        assert.equal(badStatus.status, 422);

        const exactExecution = await httpGet(
          baseUrl,
          `/api/v1/execution/plans?executionId=${encodeURIComponent(
            ((page.body.data as Record<string, unknown>).items as Record<string, unknown>[])[0]
              .planId as string,
          )}`,
          analystIdentity(),
        );
        assert.equal(exactExecution.status, 200);

        const badSort = await httpGet(
          baseUrl,
          '/api/v1/execution/plans?sort=riskLevel',
          analystIdentity(),
        );
        assert.equal(badSort.status, 422);

        const ascSort = await httpGet(
          baseUrl,
          '/api/v1/execution/plans?sortOrder=asc',
          analystIdentity(),
        );
        assert.equal(ascSort.status, 422);
      });
    });
  });

  describe('GET runs', () => {
    it('lists and retrieves tenant-scoped runs only', async () => {
      const ctx = createHttpContext();
      await seedTenantOwner(ctx);
      const app = createExecutionHttpApp(ctx);
      const privileged = privilegedIdentity('owner-a');

      await withHttpServer(app, async (baseUrl) => {
        const approved = await prepareApprovedPlan(baseUrl, analystIdentity(), privileged);
        const executed = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/execution/plans/${approved.planId}/execute`,
          privileged,
          { expectedVersion: approved.version },
        );
        const run = (executed.body.data as Record<string, unknown>).run as Record<
          string,
          unknown
        >;
        assert.ok(run?.runId);

        const list = await httpGet(baseUrl, '/api/v1/execution/runs', analystIdentity());
        assert.equal(list.status, 200);
        const listItems = (list.body.data as Record<string, unknown>).items as Record<
          string,
          unknown
        >[];
        assert.ok(listItems.every((item) => item.tenantId === TENANT_A));

        const otherTenantList = await httpGet(
          baseUrl,
          '/api/v1/execution/runs',
          analystIdentity('reader-b', TENANT_B),
        );
        assert.equal(
          ((otherTenantList.body.data as Record<string, unknown>).items as unknown[]).length,
          0,
        );

        const getRun = await httpGet(
          baseUrl,
          `/api/v1/execution/runs/${run.runId}`,
          analystIdentity(),
        );
        assert.equal(getRun.status, 200);

        const crossTenantRun = await httpGet(
          baseUrl,
          `/api/v1/execution/runs/${run.runId}`,
          analystIdentity('reader-b', TENANT_B),
        );
        assert.equal(crossTenantRun.status, 404);
      });
    });
  });
});
