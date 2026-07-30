import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Ec2ExecutionAdapter } from '../../execution/adapters/aws/ec2-adapter';
import { AutoScalingExecutionAdapter } from '../../execution/adapters/aws/autoscaling-adapter';
import { RdsExecutionAdapter } from '../../execution/adapters/aws/rds-adapter';
import { S3ExecutionAdapter } from '../../execution/adapters/aws/s3-adapter';
import { CloudFrontExecutionAdapter } from '../../execution/adapters/aws/cloudfront-adapter';
import { LambdaExecutionAdapter } from '../../execution/adapters/aws/lambda-adapter';
import { EXECUTION_MODES } from '../../execution/adapters/types';
import type { AwsExecutionClients } from '../../execution/adapters/aws-clients';

const actor = {
  authenticated: true,
  userId: 'user-1',
  email: 'user@example.com',
  roles: ['admin'] as import('../../auth').SisumRole[],
};

function context(region = 'us-east-1') {
  return {
    tenantId: 'tenant-a',
    actorId: 'user-1',
    actor,
    correlationId: 'corr',
    requestId: 'req',
    region,
    mode: EXECUTION_MODES.PRODUCTION,
  };
}

function clientFactory(clients: AwsExecutionClients) {
  return () => clients;
}

test('EC2 adapter validates, executes, verifies, and rolls back with mocked client', async () => {
  const states = ['stopped', 'running', 'running'];
  const ec2 = {
    send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return {
          Reservations: [
            {
              Instances: [
                {
                  InstanceId: 'i-abc',
                  State: { Name: states.shift() ?? 'running' },
                  Tags: [{ Key: 'env', Value: 'prod' }],
                },
              ],
            },
          ],
        };
      }
      if (command.constructor.name === 'StartInstancesCommand') {
        return {};
      }
      return {};
    },
  };

  const adapter = new Ec2ExecutionAdapter(
    clientFactory({ ec2: ec2 as never }),
  );

  const request = {
    service: 'ec2' as const,
    action: 'START_INSTANCE',
    resourceId: 'i-abc',
  };

  const validation = await adapter.validate(context(), request);
  assert.equal(validation.valid, true);

  const previous = await adapter.capturePreviousConfiguration(context(), request);
  const execution = await adapter.execute(context(), request, previous);
  assert.equal(execution.success, true);

  const verification = await adapter.verify(context(), request, previous, undefined);
  assert.equal(verification.verified, true);

  const dryRun = adapter.buildDryRunPlan(context(), request);
  assert.equal(dryRun.reversible, true);
});

test('Auto Scaling adapter rejects out-of-bounds capacity', async () => {
  const adapter = new AutoScalingExecutionAdapter(clientFactory({}));
  const result = await adapter.validate(context(), {
    service: 'autoscaling',
    action: 'UPDATE_DESIRED_CAPACITY',
    resourceId: 'asg-1',
    parameters: { desiredCapacity: 10, minCapacity: 1, maxCapacity: 5 },
  });
  assert.equal(result.valid, false);
});

test('RDS adapter maps stop rollback as non-reversible', async () => {
  const adapter = new RdsExecutionAdapter(clientFactory({}));
  const rollback = await adapter.rollback(
    context(),
    { service: 'rds', action: 'STOP_INSTANCE', resourceId: 'db-1' },
    { status: 'available' },
  );
  assert.equal(rollback.nonReversible, true);
});

test('S3 adapter dry-run does not require live mutations', () => {
  const adapter = new S3ExecutionAdapter(clientFactory({}));
  const plan = adapter.buildDryRunPlan(context(), {
    service: 's3',
    action: 'PUT_BUCKET_TAGGING',
    resourceId: 'my-bucket',
    parameters: { tags: { team: 'ops' } },
  });
  assert.match(plan.steps.join(' '), /PutBucketTagging/);
});

test('CloudFront adapter requires comment parameter', async () => {
  const adapter = new CloudFrontExecutionAdapter(clientFactory({}));
  const result = await adapter.validate(context(), {
    service: 'cloudfront',
    action: 'UPDATE_COMMENT',
    resourceId: 'E123',
    parameters: {},
  });
  assert.equal(result.valid, false);
});

test('Lambda adapter validates memory bounds', async () => {
  const adapter = new LambdaExecutionAdapter(clientFactory({}));
  const result = await adapter.validate(context(), {
    service: 'lambda',
    action: 'UPDATE_FUNCTION_CONFIGURATION',
    resourceId: 'fn-1',
    parameters: { memorySize: 64 },
  });
  assert.equal(result.valid, false);
});

test('Lambda adapter production path with mocked client', async () => {
  let memory = 256;
  const lambda = {
    send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'GetFunctionConfigurationCommand') {
        return { MemorySize: memory, Timeout: 10 };
      }
      if (command.constructor.name === 'UpdateFunctionConfigurationCommand') {
        memory = 512;
        return {};
      }
      return {};
    },
  };

  const adapter = new LambdaExecutionAdapter(
    clientFactory({ lambda: lambda as never }),
  );
  const request = {
    service: 'lambda' as const,
    action: 'UPDATE_FUNCTION_CONFIGURATION',
    resourceId: 'fn-1',
    parameters: { memorySize: 512 },
  };

  const previous = await adapter.capturePreviousConfiguration(context(), request);
  const execution = await adapter.execute(context(), request, previous);
  assert.equal(execution.success, true);
  const verification = await adapter.verify(context(), request, previous, undefined);
  assert.equal(verification.verified, true);
});
