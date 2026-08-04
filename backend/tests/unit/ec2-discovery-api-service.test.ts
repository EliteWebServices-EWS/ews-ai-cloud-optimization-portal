import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { Ec2DiscoveryApiService } from '../../services/ec2-discovery-api-service';
import { StsCredentialProvider } from '../../execution/adapters/sts';

async function seedVerified(
  repo: MockAwsAccountRepository,
  tenantId: string,
  accountId: string,
) {
  await repo.create({
    tenantId,
    accountId,
    roleArn: `arn:aws:iam::${accountId}:role/R`,
    externalId: 'ext',
    region: 'us-east-1',
    status: 'PENDING',
    verificationStatus: 'NOT_STARTED',
    metadata: {},
  });
  await repo.transitionStatus(tenantId, accountId, 'VALIDATING', { expectedVersion: 1 });
  await repo.transitionStatus(tenantId, accountId, 'VERIFIED', { expectedVersion: 2 });
}

describe('Ec2DiscoveryApiService credential failures', () => {
  it('maps AssumeRole failure without exposing raw STS message in discovery warnings', async () => {
    const awsRepo = new MockAwsAccountRepository();
    const resources = new MockEc2CloudResourceRepository();
    await seedVerified(awsRepo, 'tenant-a', '111122223333');
    const sts = {
      send: async () => {
        const err = new Error('is not authorized to perform: sts:AssumeRole on resource');
        err.name = 'AccessDenied';
        throw err;
      },
    };
    const service = new Ec2DiscoveryApiService(
      awsRepo,
      resources,
      resources,
      new StsCredentialProvider({ stsClient: sts as never, maxAttempts: 1 }),
    );
    const result = await service.startDiscovery(
      'tenant-a',
      '111122223333',
      {},
      {
        actor: { authenticated: true, userId: 'u1', email: 'u1@example.com', roles: ['admin'] },
        requestId: 'req-1',
        correlationId: 'corr-1',
      },
    );
    assert.equal(result.status, 'FAILED');
    assert.ok(result.warnings.length > 0);
    assert.doesNotMatch(JSON.stringify(result), /sts:AssumeRole on resource/);
    assert.doesNotMatch(JSON.stringify(result), /is not authorized to perform/);
  });
});
