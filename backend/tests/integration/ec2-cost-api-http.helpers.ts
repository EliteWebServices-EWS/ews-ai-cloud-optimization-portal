import assert from 'node:assert/strict';
import express from 'express';

import { createEc2CostRoutes } from '../../api/routes/ec2-cost.routes';
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
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { Ec2CostAnalysisApiService } from '../../services/ec2-cost-analysis-api-service';
import type { Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import {
  httpJson,
  seedMembership,
  seedVerifiedAccount,
  type TestIdentity,
} from './ec2-discovery-http.helpers';

export const COST_TENANT_A = 'tenant-ec2-cost-a';
export const COST_TENANT_B = 'tenant-ec2-cost-b';
export const COST_ACCOUNT_A = '572262081497';
export const COST_ACCOUNT_B = '444455556666';

export function sisumGroupsForTenantRole(role: TenantRole): string {
  if (role === TENANT_ROLES.ANALYST) {
    return 'analyst';
  }
  if (role === TENANT_ROLES.VIEWER || role === TENANT_ROLES.AUDITOR) {
    return 'viewer';
  }
  return 'admin';
}

export function costIdentity(
  tenantId: string,
  userId: string,
  membershipRole: TenantRole,
  authenticated = true,
): TestIdentity {
  return {
    tenantId,
    userId,
    authenticated,
    groups: [sisumGroupsForTenantRole(membershipRole)],
  };
}

export interface Ec2CostHttpContext {
  awsRepo: MockAwsAccountRepository;
  resources: MockEc2CloudResourceRepository;
  costRepo: MockEc2CostRepository;
  membershipRepository: InMemoryMembershipRepository;
  service: Ec2CostAnalysisApiService;
  app: express.Application;
}

export function buildEc2CostHttpApp(options?: {
  service?: Ec2CostAnalysisApiService;
  resources?: MockEc2CloudResourceRepository;
  costRepo?: MockEc2CostRepository;
  awsRepo?: MockAwsAccountRepository;
}): Ec2CostHttpContext {
  const awsRepo = options?.awsRepo ?? new MockAwsAccountRepository();
  const resources = options?.resources ?? new MockEc2CloudResourceRepository();
  const costRepo = options?.costRepo ?? new MockEc2CostRepository();
  const membershipRepository = new InMemoryMembershipRepository();
  const service =
    options?.service ??
    new Ec2CostAnalysisApiService(awsRepo, resources, costRepo, costRepo);

  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
  app.use(requireTenantContext());
  app.use(
    '/api/v1',
    createEc2CostRoutes({ ec2CostAnalysisApi: service, membershipRepository }),
  );

  return { awsRepo, resources, costRepo, membershipRepository, service, app };
}

export { httpJson, seedMembership, seedVerifiedAccount };

export function assertNoSensitiveFields(body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  const forbidden = [
    'accessKeyId',
    'secretAccessKey',
    'sessionToken',
    'ExternalId',
    'Authorization',
    '$metadata',
    'ext-test-value-never-logged',
    'fake-secret',
  ];
  for (const token of forbidden) {
    assert.doesNotMatch(text, new RegExp(token, 'i'));
  }
}

export function captureAuditEvents(): {
  events: string[];
  restore: () => void;
} {
  const auditEvents: string[] = [];
  const originalInfo = console.info;
  const originalErr = console.error;
  const capture = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        try {
          const parsed = JSON.parse(arg) as { category?: string; eventName?: string };
          if (parsed.category === 'audit') {
            auditEvents.push(arg);
          }
        } catch {
          // ignore non-JSON log lines
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
  return {
    events: auditEvents,
    restore: () => {
      console.info = originalInfo;
      console.error = originalErr;
    },
  };
}

export function seedRecommendation(
  costRepo: MockEc2CostRepository,
  rec: Ec2CostRecommendationRecord,
): void {
  costRepo.seedRecommendation(rec);
}
