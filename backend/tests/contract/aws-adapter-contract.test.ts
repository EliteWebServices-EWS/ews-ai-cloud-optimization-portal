import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDefaultExecutionAdapterRegistry } from '../../execution/adapters/adapter-registry';
import { Ec2ExecutionAdapter } from '../../execution/adapters/aws/ec2-adapter';
import { AutoScalingExecutionAdapter } from '../../execution/adapters/aws/autoscaling-adapter';
import { RdsExecutionAdapter } from '../../execution/adapters/aws/rds-adapter';
import { S3ExecutionAdapter } from '../../execution/adapters/aws/s3-adapter';
import { CloudFrontExecutionAdapter } from '../../execution/adapters/aws/cloudfront-adapter';
import { LambdaExecutionAdapter } from '../../execution/adapters/aws/lambda-adapter';
import { EXECUTION_MODES, type ExecutionAdapter } from '../../execution/adapters/types';
import { ADAPTER_SERVICES, awsError } from './adapter-contract-helpers';

const actor = {
  authenticated: true,
  userId: 'contract-user',
  email: 'contract@example.com',
  roles: ['admin'] as import('../../auth').SisumRole[],
};

function ctx() {
  return {
    tenantId: 'tenant-contract',
    actorId: 'contract-user',
    actor,
    correlationId: 'corr',
    requestId: 'req',
    region: 'us-east-1',
    mode: EXECUTION_MODES.PRODUCTION,
  };
}

describe('AWS adapter contract validation', () => {
  it('registry resolves every supported service adapter', () => {
    const registry = createDefaultExecutionAdapterRegistry(() => ({}));
    for (const service of ADAPTER_SERVICES) {
      const adapter = registry.resolve(service);
      assert.equal(adapter.service, service);
      assert.ok(adapter.supportedActions().length > 0);
    }
  });

  it('all adapters expose validate, execute, verify, rollback, and dry-run plan', () => {
    const adapters: ExecutionAdapter[] = [
      new Ec2ExecutionAdapter(() => ({})),
      new AutoScalingExecutionAdapter(() => ({})),
      new RdsExecutionAdapter(() => ({})),
      new S3ExecutionAdapter(() => ({})),
      new CloudFrontExecutionAdapter(() => ({})),
      new LambdaExecutionAdapter(() => ({})),
    ];

    for (const adapter of adapters) {
      assert.equal(typeof adapter.validate, 'function');
      assert.equal(typeof adapter.execute, 'function');
      assert.equal(typeof adapter.verify, 'function');
      assert.equal(typeof adapter.rollback, 'function');
      assert.equal(typeof adapter.buildDryRunPlan, 'function');
      assert.equal(typeof adapter.isRollbackEligible, 'function');
    }
  });

  it('maps AWS access denied errors into structured execution errors (EC2)', async () => {
    const ec2 = {
      send: async () => {
        throw awsError('AccessDenied', 'Access denied');
      },
    };
    const adapter = new Ec2ExecutionAdapter(() => ({ ec2: ec2 as never }));
    const validation = await adapter.validate(ctx(), {
      service: 'ec2',
      action: 'START_INSTANCE',
      resourceId: 'i-deny',
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.errors?.[0]?.code, 'AWS_SDK_ERROR');
    assert.equal(validation.errors?.[0]?.awsErrorName, 'AccessDenied');
  });

  it('maps throttling errors without contacting AWS (Lambda)', async () => {
    const lambda = {
      send: async () => {
        throw awsError('ThrottlingException', 'Rate exceeded');
      },
    };
    const adapter = new LambdaExecutionAdapter(() => ({ lambda: lambda as never }));
    const validation = await adapter.validate(ctx(), {
      service: 'lambda',
      action: 'UPDATE_FUNCTION_CONFIGURATION',
      resourceId: 'fn',
      parameters: { memorySize: 256 },
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.errors?.[0]?.retryable, true);
  });
});
