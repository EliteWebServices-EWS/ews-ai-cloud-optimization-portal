/**
 * Shared fixtures for Sprint 12 tenant-administration integration tests.
 *
 * Uses identitySource lambda-adapter middleware so injected x-sisum-* headers
 * simulate post-Lambda context. This is test-only — not valid on direct HTTP.
 */

import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApiRoutes } from '../../../api/routes/index';
import {
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createConfidenceEngine,
  createRecommendationEngine,
  createVerificationEngine,
  createLearningStore,
} from '../../../engines';
import { createExecutionSimulator, createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../../execution';
import { ExecutionApiService } from '../../../services/execution-api-service';
import { createInMemoryExecutionStores } from '../execution/fixtures';
import { createWorkflowOrchestrator } from '../../../orchestrator';
import { createPluginRegistry } from '../../../plugins';
import { createProvider } from '../../../providers';
import { PROVIDER_NAMES } from '../../../shared/constants';
import {
  createMembershipService,
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
} from '../../../membership';
import { MockTenantRepository } from '../../../repositories/mock/mock-tenant-repository';
import {
  createCorsMiddleware,
  createJsonBodyParser,
  createJsonErrorHandler,
  createSecurityHeadersMiddleware,
} from '../../../security';
import { auditPersistenceFlushMiddleware } from '../../../audit';
import { createIdentitySourceMiddleware } from '../../../auth/identity-source';
import type { SisumRole } from '../../../auth/roles';
import type { TenantRole } from '../../../auth/tenant-roles';

export const TENANT_A = 'tenant-s12-a';
export const TENANT_B = 'tenant-s12-b';

export const USER_PLATFORM_ADMIN = 'user-platform-admin';
export const USER_TENANT_A_OWNER = 'user-tenant-a-owner';
export const USER_TENANT_A_ADMIN = 'user-tenant-a-admin';
export const USER_TENANT_B_OWNER = 'user-tenant-b-owner';
export const USER_VIEWER = 'user-viewer-a';
export const USER_ANALYST = 'user-analyst-a';
export const USER_SECURITY_ADMIN = 'user-security-admin-a';
export const USER_AUDITOR = 'user-auditor-a';
export const USER_INVITEE = 'user-invitee';

export interface IdentityFixture {
  userId: string;
  email?: string;
  groups: SisumRole[];
  tenantId: string;
  /** Simulates lambda output after boolean JWT claim — policy test only, not Cognito. */
  sessionMfaVerified?: boolean;
}

export interface TestAppContext {
  app: express.Application;
  tenantRepository: MockTenantRepository;
  membershipRepository: InMemoryMembershipRepository;
  invitationRepository: InMemoryInvitationRepository;
}

export function identityHeaders(identity: IdentityFixture): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-sisum-authenticated': 'true',
    'x-sisum-user-id': identity.userId,
    'x-sisum-user-email': identity.email ?? `${identity.userId}@example.com`,
    'x-sisum-user-groups': identity.groups.join(','),
    'x-sisum-token-use': 'access',
    'x-sisum-client-id': 'test-client',
    'x-sisum-tenant-id': identity.tenantId,
  };

  if (identity.sessionMfaVerified) {
    headers['x-sisum-mfa-session-verified'] = 'true';
  }

  return headers;
}

export function buildTestApp(): TestAppContext {
  process.env.NODE_ENV = 'test';
  process.env.PERSISTENCE_ENABLED = 'false';
  delete process.env.TENANTS_TABLE_NAME;
  delete process.env.MEMBERSHIPS_TABLE_NAME;
  delete process.env.INVITATIONS_TABLE_NAME;

  const tenantRepository = new MockTenantRepository();
  const membershipRepository = new InMemoryMembershipRepository();
  const invitationRepository = new InMemoryInvitationRepository();
  const membershipService = createMembershipService({
    membershipRepository,
    invitationRepository,
  });

  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);
  const learningStore = createLearningStore();
  const executionSimulator = createExecutionSimulator();
  const orchestrator = createWorkflowOrchestrator({
    evidenceEngine: createEvidenceEngine(),
    governanceEngine: createGovernanceEngine(),
    financialEngine: createFinancialEngine({ provider }),
    confidenceEngine: createConfidenceEngine(),
    recommendationEngine: createRecommendationEngine(),
    verificationEngine: createVerificationEngine(),
    executionSimulator,
    learningStore,
    getPlugin: (name) => pluginRegistry.get(name),
  });

  const executionStores = createInMemoryExecutionStores();
  const executionOrchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(() => ({})),
    runs: executionStores.runs,
  });
  const executionApi = new ExecutionApiService({
    plans: executionStores.plans,
    runs: executionStores.runs,
    history: executionStores.history,
    orchestrator: executionOrchestrator,
  });

  const app = express();
  app.use(createSecurityHeadersMiddleware());
  app.use(createCorsMiddleware());
  app.use(createJsonBodyParser());
  app.use(createJsonErrorHandler());
  // Test-only: simulates Express after Lambda adapter (not direct HTTP).
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(auditPersistenceFlushMiddleware);
  app.use(
    '/api/v1',
    createApiRoutes({
      orchestrator,
      pluginRegistry,
      provider,
      activeProvider: PROVIDER_NAMES.MOCK,
      executionSimulator,
      learningStore,
      reportingEngine: {
        queryReports: async () => ({ reports: [], total: 0 }),
        getReport: async () => undefined,
        getReportByWorkflowId: async () => undefined,
        resolveReportOwnerTenantId: async () => undefined,
        resolveReportOwnerTenantIdByWorkflow: async () => undefined,
        execute: async () => ({ success: false }),
      } as never,
      membershipService,
      membershipRepository,
      tenantRepository,
      executionApi,
    }),
  );

  return {
    app,
    tenantRepository,
    membershipRepository,
    invitationRepository,
  };
}

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  rawBody: string;
}

export async function httpRequest<T = unknown>(
  app: express.Application,
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<HttpResponse<T>> {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const payload =
      options.body === undefined ? undefined : JSON.stringify(options.body);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let rawBody = '';
        res.on('data', (chunk) => {
          rawBody += chunk;
        });
        res.on('end', () => {
          server.close();
          let body: T;
          try {
            body = rawBody.length > 0 ? (JSON.parse(rawBody) as T) : ({} as T);
          } catch {
            body = rawBody as T;
          }
          resolve({
            status: res.statusCode ?? 0,
            body,
            rawBody,
          });
        });
      },
    );

    req.on('error', (error) => {
      server.close();
      reject(error);
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

export async function seedTenantMembership(
  membershipRepository: InMemoryMembershipRepository,
  input: {
    tenantId: string;
    userId: string;
    role: TenantRole;
    status?: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  },
): Promise<string> {
  const record = await membershipRepository.create({
    tenantId: input.tenantId,
    memberId: `mem-${input.userId}`,
    userId: input.userId,
    role: input.role,
    status: input.status ?? 'ACTIVE',
    joinedAt: new Date(0).toISOString(),
    statusChangedAt: new Date(0).toISOString(),
    statusChangedBy: 'fixture',
    invitedBy: 'fixture',
  });

  return record.memberId;
}

export async function seedActiveTenant(
  tenantRepository: MockTenantRepository,
  input: {
    tenantId: string;
    slug: string;
    ownerUserId: string;
  },
) {
  const tenant = await tenantRepository.create({
    tenantId: input.tenantId,
    organizationName: 'Org',
    displayName: 'Display',
    slug: input.slug,
    ownerUserId: input.ownerUserId,
    primaryContact: { name: 'Contact', email: 'contact@example.com' },
    region: 'us-east-1',
    subscriptionPlan: 'standard',
    status: 'PROVISIONING',
  });

  return tenantRepository.transitionStatus(input.tenantId, 'ACTIVE', {
    expectedVersion: tenant.version,
  });
}

export function assertNoSecretsInPayload(raw: string): void {
  const forbidden = [
    /Authorization:\s*Bearer/i,
    /BEGIN PRIVATE KEY/,
    /refresh_token/i,
    /client_secret/i,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(raw)) {
      throw new Error(`Sensitive pattern detected in response: ${pattern}`);
    }
  }
}
