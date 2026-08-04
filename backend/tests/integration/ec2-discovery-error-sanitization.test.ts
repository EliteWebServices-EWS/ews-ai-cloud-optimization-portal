import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';

import { createEc2Routes } from '../../api/routes/ec2.routes';
import { InvalidPaginationTokenError, RepositoryConflictError } from '../../database';
import { AppError } from '../../shared/utils';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
} from '../../auth';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { Ec2DiscoveryApiService } from '../../services/ec2-discovery-api-service';
import { EC2_PUBLIC_INTERNAL_ERROR_MESSAGE } from '../../api/ec2-api-error-handling';
import {
  ACCOUNT_A,
  TENANT_A,
  httpJson,
  seedMembership,
  withHttpServer,
} from './ec2-discovery-http.helpers';

const INTERNAL_DETAIL = 'internal table sisum-cloud-resources-production failed';

function buildAppWithService(
  service: Pick<Ec2DiscoveryApiService, 'startDiscovery' | 'listResources' | 'getResource' | 'getSummary'>,
) {
  const membershipRepository = new InMemoryMembershipRepository();
  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(
    '/api/v1',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requireTenantContext(),
    createEc2Routes({
      ec2DiscoveryApi: service as Ec2DiscoveryApiService,
      membershipRepository,
    }),
  );
  return { app, membershipRepository };
}

describe('EC2 API error sanitization', () => {
  let internalLogs: string[] = [];
  const originalError = console.error;

  before(() => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    internalLogs = [];
    console.error = (...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === 'string') {
          internalLogs.push(arg);
        }
      }
      originalError.apply(console, args);
    };
  });

  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
    console.error = originalError;
  });

  it('returns generic HTTP 500 without leaking internal Error.message', async () => {
    const err = new Error(INTERNAL_DETAIL);
    err.name = 'ConditionalCheckFailedException';
    const stub = {
      startDiscovery: async () => {
        throw err;
      },
      listResources: async () => {
        throw err;
      },
      getResource: async () => {
        throw err;
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 500);
      const payload = JSON.stringify(res.body);
      assert.equal((res.body as { error: { message: string } }).error.message, EC2_PUBLIC_INTERNAL_ERROR_MESSAGE);
      assert.doesNotMatch(payload, /sisum-cloud-resources-production/);
      assert.doesNotMatch(payload, new RegExp(INTERNAL_DETAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(payload, /ConditionalCheckFailedException/);
      assert.doesNotMatch(payload, /at Object\./);
      assert.doesNotMatch(payload, /\$metadata/);
    });
  });

  it('logs internal failure details server-side', async () => {
    internalLogs.length = 0;
    const stub = {
      startDiscovery: async () => {
        throw new Error(INTERNAL_DETAIL);
      },
      listResources: async () => {
        throw new Error(INTERNAL_DETAIL);
      },
      getResource: async () => {
        throw new Error(INTERNAL_DETAIL);
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await withHttpServer(app, async (baseUrl) => {
      await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
    });
    const joined = internalLogs.join('\n');
    assert.match(joined, /ec2-api-internal/);
    assert.match(joined, /sisum-cloud-resources-production/);
    assert.match(joined, /ec2\.resource_list/);
  });

  it('preserves RepositoryConflictError as 409 CONFLICT', async () => {
    const stub = {
      startDiscovery: async () => {
        throw new RepositoryConflictError('EC2 cloud resource version conflict.');
      },
      listResources: async () => {
        throw new RepositoryConflictError('EC2 cloud resource version conflict.');
      },
      getResource: async () => {
        throw new RepositoryConflictError('version conflict');
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 409);
      assert.equal((res.body as { error: { code: string } }).error.code, 'CONFLICT');
    });
  });

  it('preserves pagination token validation as 422', async () => {
    const stub = {
      startDiscovery: async () => {
        throw new InvalidPaginationTokenError();
      },
      listResources: async () => {
        throw new InvalidPaginationTokenError();
      },
      getResource: async () => {
        throw new InvalidPaginationTokenError();
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 422);
    });
  });

  it('preserves known AppError mappings such as AWS_ACCOUNT_NOT_VERIFIED', async () => {
    const stub = {
      startDiscovery: async () => {
        throw new AppError(
          'AWS_ACCOUNT_NOT_VERIFIED',
          'AWS account must be VERIFIED before EC2 discovery.',
          409,
        );
      },
      listResources: async () => {
        throw new AppError('AWS_ACCOUNT_NOT_VERIFIED', 'not verified', 409);
      },
      getResource: async () => {
        throw new AppError('AWS_ACCOUNT_NOT_VERIFIED', 'not verified', 409);
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(res.status, 409);
      assert.equal((res.body as { error: { code: string } }).error.code, 'AWS_ACCOUNT_NOT_VERIFIED');
    });
  });

  it('audit failure events exclude raw internal Error.message', async () => {
    const auditEvents: string[] = [];
    const originalInfo = console.info;
    const originalErr = console.error;
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
    try {
      const stub = {
        startDiscovery: async () => {
          throw new Error(INTERNAL_DETAIL);
        },
        listResources: async () => {
          throw new Error(INTERNAL_DETAIL);
        },
        getResource: async () => {
          throw new Error(INTERNAL_DETAIL);
        },
        getSummary: async () => ({
          totalResources: 0,
          instancesByState: {},
          instancesByRegion: {},
          instancesByInstanceType: {},
          resourcesByType: {},
          staleResourceCount: 0,
        }),
      };
      const { app, membershipRepository } = buildAppWithService(stub);
      await seedMembership(membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
      await withHttpServer(app, async (baseUrl) => {
        await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
          { userId: 'owner-a', tenantId: TENANT_A },
          {},
        );
      });
      const auditBlob = auditEvents.join('\n');
      assert.match(auditBlob, /ec2\.discovery_failed/);
      assert.doesNotMatch(auditBlob, /sisum-cloud-resources-production/);
    } finally {
      console.info = originalInfo;
      console.error = originalErr;
    }
  });
});
