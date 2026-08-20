import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import { createExecutionRoutes } from '../../../api/routes/execution.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
} from '../../../auth';
import { TENANT_ROLES } from '../../../auth/tenant-roles';
import {
  createDefaultExecutionAdapterRegistry,
  createExecutionOrchestrator,
} from '../../../execution';
import type { AwsExecutionClientFactory } from '../../../execution/adapters/aws-clients';
import { InMemoryMembershipRepository } from '../../../membership/membership.store';
import { ExecutionApiService } from '../../../services/execution-api-service';
import { buildExecutionApiPolicyContext } from '../../fixtures/action-policy/policy-fixtures';
import {
  createInMemoryExecutionStores,
  TENANT_A,
  TENANT_B,
} from '../execution/fixtures';

export { TENANT_A, TENANT_B };

export interface TestIdentity {
  userId: string;
  tenantId: string;
  groups?: string[];
  sessionMfaVerified?: boolean;
  authenticated?: boolean;
}

export function identityHeaders(identity: TestIdentity): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (identity.authenticated !== false) {
    headers['x-sisum-authenticated'] = 'true';
    headers['x-sisum-token-use'] = 'access';
    headers['x-sisum-client-id'] = 'test-client';
  }

  headers['x-sisum-user-id'] = identity.userId;
  headers['x-sisum-user-email'] = `${identity.userId}@example.com`;
  headers['x-sisum-user-groups'] = (identity.groups ?? ['admin']).join(',');
  headers['x-sisum-tenant-id'] = identity.tenantId;

  if (identity.sessionMfaVerified) {
    headers['x-sisum-mfa-session-verified'] = 'true';
  }

  return headers;
}

export function buildPlanBody(overrides: Record<string, unknown> = {}) {
  const { policyContext, ...rest } = overrides;
  return {
    workflowId: 'wf-http-1',
    recommendationId: 'rec-http-1',
    approvalRequired: true,
    riskLevel: 'LOW',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-http-1',
        description: 'start instance',
      },
    ],
    rollbackPlan: { strategy: 'REVERSE', steps: [], automatic: true },
    policyContext:
      policyContext ??
      buildExecutionApiPolicyContext({
        resourceId: 'i-http-1',
        findingKey: 'finding-http-1',
      }),
    ...rest,
  };
}

export function defaultEc2Factory(options?: {
  onSend?: () => void;
}): AwsExecutionClientFactory {
  let started = false;
  return () => ({
    ec2: {
      send: async (command: { constructor: { name: string } }) => {
        options?.onSend?.();
        if (command.constructor.name === 'DescribeInstancesCommand') {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-http-1',
                    State: { Name: started ? 'running' : 'stopped' },
                    Tags: [],
                  },
                ],
              },
            ],
          };
        }
        if (command.constructor.name === 'StartInstancesCommand') {
          started = true;
          return {};
        }
        if (command.constructor.name === 'StopInstancesCommand') {
          started = false;
          return {};
        }
        return {};
      },
    } as never,
  });
}

export interface ExecutionHttpTestContext {
  stores: ReturnType<typeof createInMemoryExecutionStores>;
  membershipRepository: InMemoryMembershipRepository;
  awsSendCount: { value: number };
}

export function createExecutionHttpApp(ctx: ExecutionHttpTestContext) {
  const orchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(
      defaultEc2Factory({ onSend: () => { ctx.awsSendCount.value += 1; } }),
    ),
    runs: ctx.stores.runs,
  });

  const executionApi = new ExecutionApiService({
    plans: ctx.stores.plans,
    runs: ctx.stores.runs,
    history: ctx.stores.history,
    orchestrator,
  });

  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(
    '/api/v1',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requireTenantContext(),
    createExecutionRoutes({
      executionApi,
      membershipRepository: ctx.membershipRepository,
    }),
  );

  return app;
}

export async function withHttpServer<T>(
  app: express.Application,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export async function httpJson(
  baseUrl: string,
  method: string,
  path: string,
  identity: TestIdentity,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: identityHeaders(identity),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

export function createHttpContext(): ExecutionHttpTestContext {
  return {
    stores: createInMemoryExecutionStores(),
    membershipRepository: new InMemoryMembershipRepository(),
    awsSendCount: { value: 0 },
  };
}

export async function seedTenantOwner(ctx: ExecutionHttpTestContext, userId = 'owner-a') {
  await ctx.membershipRepository.create({
    tenantId: TENANT_A,
    userId,
    memberId: `member-${userId}`,
    role: TENANT_ROLES.TENANT_OWNER,
    status: 'ACTIVE',
    joinedAt: new Date().toISOString(),
    statusChangedAt: new Date().toISOString(),
  });
}

export async function seedSecurityAdmin(ctx: ExecutionHttpTestContext, userId = 'sec-admin-a') {
  await ctx.membershipRepository.create({
    tenantId: TENANT_A,
    userId,
    memberId: `member-${userId}`,
    role: TENANT_ROLES.SECURITY_ADMIN,
    status: 'ACTIVE',
    joinedAt: new Date().toISOString(),
    statusChangedAt: new Date().toISOString(),
  });
}

export function privilegedIdentity(
  userId: string,
  tenantId: string = TENANT_A,
  sessionMfaVerified = true,
): TestIdentity {
  return {
    userId,
    tenantId,
    groups: ['admin'],
    sessionMfaVerified,
  };
}

export function analystIdentity(userId = 'analyst-a', tenantId: string = TENANT_A): TestIdentity {
  return {
    userId,
    tenantId,
    groups: ['analyst'],
  };
}

export async function createPlanViaHttp(
  baseUrl: string,
  identity: TestIdentity,
  overrides: Record<string, unknown> = {},
) {
  const response = await httpJson(
    baseUrl,
    'POST',
    '/api/v1/execution/plans',
    identity,
    buildPlanBody(overrides),
  );
  assert.equal(response.status, 201);
  const data = response.body.data as Record<string, unknown>;
  return {
    planId: String(data.planId),
    version: Number(data.version),
    raw: data,
  };
}

export async function submitForApproval(
  baseUrl: string,
  identity: TestIdentity,
  planId: string,
  expectedVersion: number,
) {
  const response = await httpJson(
    baseUrl,
    'PATCH',
    `/api/v1/execution/plans/${planId}`,
    identity,
    { expectedVersion, submitForApproval: true },
  );
  assert.equal(response.status, 200);
  const data = response.body.data as Record<string, unknown>;
  return { version: Number(data.version), planStatus: String(data.planStatus) };
}

export async function approvePlanViaHttp(
  baseUrl: string,
  identity: TestIdentity,
  planId: string,
  expectedVersion: number,
) {
  const response = await httpJson(
    baseUrl,
    'POST',
    `/api/v1/execution/plans/${planId}/approve`,
    identity,
    { expectedVersion },
  );
  return response;
}

export async function prepareApprovedPlan(
  baseUrl: string,
  creator: TestIdentity,
  approver: TestIdentity,
  overrides: Record<string, unknown> = {},
) {
  const { planId, version } = await createPlanViaHttp(baseUrl, creator, overrides);
  const pending = await submitForApproval(baseUrl, creator, planId, version);
  const approved = await approvePlanViaHttp(
    baseUrl,
    approver,
    planId,
    pending.version,
  );
  assert.equal(approved.status, 200);
  const data = approved.body.data as Record<string, unknown>;
  return {
    planId,
    version: Number(data.version),
    planStatus: String(data.planStatus),
  };
}

export async function httpGet(
  baseUrl: string,
  path: string,
  identity: TestIdentity,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: identityHeaders(identity),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

export async function prepareExecutedPlan(
  baseUrl: string,
  creator: TestIdentity,
  executor: TestIdentity,
) {
  const approved = await prepareApprovedPlan(baseUrl, creator, executor);
  const executed = await httpJson(
    baseUrl,
    'POST',
    `/api/v1/execution/plans/${approved.planId}/execute`,
    executor,
    { expectedVersion: approved.version },
  );
  assert.equal(executed.status, 200);
  const latest = await httpGet(
    baseUrl,
    `/api/v1/execution/plans/${approved.planId}`,
    creator,
  );
  assert.equal(latest.status, 200);
  const plan = latest.body.data as Record<string, unknown>;
  return {
    planId: approved.planId,
    version: Number(plan.version),
  };
}
