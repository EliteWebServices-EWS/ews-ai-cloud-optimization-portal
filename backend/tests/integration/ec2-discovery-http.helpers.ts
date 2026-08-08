import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import { createEc2Routes } from '../../api/routes/ec2.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
} from '../../auth';
import type { Ec2RegionalInventoryDto } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-client.port';
import type { Ec2DiscoveryClientFactory } from '../../cloud-intelligence/plugins/ec2/ec2-cloud-discovery-plugin';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { Ec2DiscoveryApiService } from '../../services/ec2-discovery-api-service';
import { StsCredentialProvider, type StsCredentialProviderDeps } from '../../execution/adapters/sts';

export const TENANT_A = 'tenant-ec2-http-a';
export const TENANT_B = 'tenant-ec2-http-b';
export const ACCOUNT_A = '111122223333';
export const ACCOUNT_B = '444455556666';

export interface TestIdentity {
  userId: string;
  tenantId: string;
  groups?: string[];
  authenticated?: boolean;
}

export function identityHeaders(identity: TestIdentity): Record<string, string> {
  if (identity.authenticated === false) {
    return { 'content-type': 'application/json' };
  }
  return {
    'content-type': 'application/json',
    'x-sisum-authenticated': 'true',
    'x-sisum-token-use': 'access',
    'x-sisum-client-id': 'test-client',
    'x-sisum-user-id': identity.userId,
    'x-sisum-user-email': `${identity.userId}@example.com`,
    'x-sisum-user-groups': (identity.groups ?? ['admin']).join(','),
    'x-sisum-tenant-id': identity.tenantId,
  };
}

export function emptyInventory(): Ec2RegionalInventoryDto {
  return {
    instances: [],
    images: [],
    volumes: [],
    elasticIps: [],
    networkInterfaces: [],
    placementGroups: [],
    launchTemplates: [],
  };
}

export function inventoryWithInstance(instanceId: string, state = 'running'): Ec2RegionalInventoryDto {
  return {
    ...emptyInventory(),
    instances: [
      {
        instanceId,
        instanceType: 't3.micro',
        state,
        tags: [{ key: 'Name', value: 'app' }],
        securityGroupIds: [],
        securityGroupNames: [],
      },
    ],
  };
}

export function mockClientFactory(
  byRegion: Record<string, Ec2RegionalInventoryDto>,
  regionErrors: Record<string, Error> = {},
): Ec2DiscoveryClientFactory {
  return (_region: string) => ({
    async discoverRegionalInventory(r: string) {
      const error = regionErrors[r];
      if (error) {
        throw error;
      }
      return byRegion[r] ?? emptyInventory();
    },
  });
}

function fakeStsClient() {
  return {
    send: async () => ({
      Credentials: {
        AccessKeyId: 'ASIAFAKE',
        SecretAccessKey: 'fake-secret',
        SessionToken: 'fake-session-token',
        Expiration: new Date(Date.now() + 3600_000),
      },
      AssumedRoleUser: { AssumedRoleId: 'AROAFAKE:sisum-ec2' },
    }),
  } as unknown as StsCredentialProviderDeps['stsClient'];
}

export interface Ec2HttpContext {
  awsRepo: MockAwsAccountRepository;
  ec2Repo: MockEc2CloudResourceRepository;
  membershipRepository: InMemoryMembershipRepository;
  app: express.Application;
}

export function buildEc2HttpApp(
  clientFactory?: Ec2DiscoveryClientFactory,
  ec2Repo?: MockEc2CloudResourceRepository,
): Ec2HttpContext {
  const awsRepo = new MockAwsAccountRepository();
  const ec2RepoInstance = ec2Repo ?? new MockEc2CloudResourceRepository();
  const membershipRepository = new InMemoryMembershipRepository();
  const ec2DiscoveryApi = new Ec2DiscoveryApiService(
    awsRepo,
    ec2RepoInstance,
    ec2RepoInstance,
    new StsCredentialProvider({ stsClient: fakeStsClient(), maxAttempts: 1 }),
    clientFactory,
  );

  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(
    '/api/v1',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requireTenantContext(),
    createEc2Routes({ ec2DiscoveryApi, membershipRepository }),
  );

  return { awsRepo, ec2Repo: ec2RepoInstance, membershipRepository, app };
}

export async function seedMembership(
  repo: InMemoryMembershipRepository,
  tenantId: string,
  userId: string,
  role: (typeof TENANT_ROLES)[keyof typeof TENANT_ROLES],
) {
  await repo.create({
    tenantId,
    userId,
    memberId: `member-${userId}`,
    role,
    status: 'ACTIVE',
    joinedAt: new Date().toISOString(),
    statusChangedAt: new Date().toISOString(),
  });
}

export async function seedVerifiedAccount(
  awsRepo: MockAwsAccountRepository,
  tenantId: string,
  accountId: string,
  region: string,
) {
  await awsRepo.create({
    tenantId,
    accountId,
    roleArn: `arn:aws:iam::${accountId}:role/SisumReadOnlyIntegrationRole`,
    externalId: 'ext-test-value-never-logged',
    region,
    status: 'PENDING',
    verificationStatus: 'NOT_STARTED',
    metadata: {},
  });
  await awsRepo.transitionStatus(tenantId, accountId, 'VALIDATING', { expectedVersion: 1 });
  await awsRepo.transitionStatus(tenantId, accountId, 'VERIFIED', { expectedVersion: 2 });
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
    return await fn(`http://127.0.0.1:${(address as { port: number }).port}`);
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
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

export function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body.data as Record<string, unknown>) ?? body;
}

export function assertNoSecrets(body: Record<string, unknown>): void {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /ext-test-value-never-logged/);
  assert.doesNotMatch(serialized, /fake-secret/);
  assert.doesNotMatch(serialized, /fake-session-token/);
  assert.doesNotMatch(serialized, /ASIAFAKE/);
}
