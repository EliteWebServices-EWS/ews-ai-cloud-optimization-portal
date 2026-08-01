import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAssumeRoleClientFactory,
  withAccessDeniedRecovery,
} from '../../execution/adapters/sts/aws-service-client-factory';
import { StsCredentialProvider } from '../../execution/adapters/sts/sts-credential-provider';
import type {
  AwsAccountRoleConfig,
  StsAssumeRoleContext,
} from '../../execution/adapters/sts/sts-types';
import { Ec2ExecutionAdapter } from '../../execution/adapters/aws/ec2-adapter';

const ACTOR = {
  authenticated: true,
  userId: 'system',
  email: null,
  roles: [] as import('../../auth').SisumRole[],
};

const CONTEXT: StsAssumeRoleContext = {
  actorId: 'system',
  actor: ACTOR,
  requestId: 'req-1',
  correlationId: 'corr-1',
};

const CONFIG: AwsAccountRoleConfig = {
  tenantId: 'tenant-a',
  roleArn: 'arn:aws:iam::111122223333:role/SisumReadOnlyRole',
  externalId: 'ext-secret-a',
};

function buildFakeStsClient() {
  return {
    send: async () => ({
      Credentials: {
        AccessKeyId: 'AKIA-fake',
        SecretAccessKey: 'secret-fake',
        SessionToken: 'token-fake',
        Expiration: new Date(Date.now() + 3600_000),
      },
      AssumedRoleUser: { AssumedRoleId: 'AROAFAKE:sisum-session' },
    }),
  };
}

function noDelay(): Promise<void> {
  return Promise.resolve();
}

describe('createAssumeRoleClientFactory', () => {
  it('builds a client set with all six required AWS services', () => {
    const provider = new StsCredentialProvider({
      stsClient: buildFakeStsClient() as never,
      delay: noDelay,
    });
    const factory = createAssumeRoleClientFactory(CONFIG, {
      credentialProvider: provider,
      auditContext: CONTEXT,
    });

    const clients = factory('us-east-1');

    assert.ok(clients.ec2);
    assert.ok(clients.autoScaling);
    assert.ok(clients.rds);
    assert.ok(clients.s3);
    assert.ok(clients.cloudFront);
    assert.ok(clients.lambda);
  });

  it('returns the AwsExecutionClients type expected by existing adapters unchanged', () => {
    // Type-level check: this compiles only if the factory's return type
    // matches what the pre-existing adapters already accept.
    const provider = new StsCredentialProvider({
      stsClient: buildFakeStsClient() as never,
      delay: noDelay,
    });
    const factory = createAssumeRoleClientFactory(CONFIG, {
      credentialProvider: provider,
      auditContext: CONTEXT,
    });

    // Constructing an existing adapter with our factory proves interop
    // without any changes to the adapter itself.
    const adapter = new Ec2ExecutionAdapter(factory);
    assert.equal(adapter.service, 'ec2');
    assert.deepEqual([...adapter.supportedActions()].sort(), [
      'START_INSTANCE',
      'STOP_INSTANCE',
      'UPDATE_TAGS',
    ]);
  });

  it('caches clients per region and builds a fresh set for a new region', () => {
    const provider = new StsCredentialProvider({
      stsClient: buildFakeStsClient() as never,
      delay: noDelay,
    });
    const factory = createAssumeRoleClientFactory(CONFIG, {
      credentialProvider: provider,
      auditContext: CONTEXT,
    });

    const east1First = factory('us-east-1');
    const east1Second = factory('us-east-1');
    const west2 = factory('us-west-2');

    assert.equal(east1First.ec2, east1Second.ec2);
    assert.notEqual(east1First.ec2, west2.ec2);
  });

  it('resolves SDK client credentials through the STS credential provider', async () => {
    const provider = new StsCredentialProvider({
      stsClient: buildFakeStsClient() as never,
      delay: noDelay,
    });
    const factory = createAssumeRoleClientFactory(CONFIG, {
      credentialProvider: provider,
      auditContext: CONTEXT,
    });

    const clients = factory('us-east-1');
    const resolved = await clients.ec2!.config.credentials();

    assert.equal(resolved.accessKeyId, 'AKIA-fake');
    assert.equal(resolved.sessionToken, 'token-fake');
  });
});

describe('withAccessDeniedRecovery', () => {
  it('passes through successful calls unchanged', async () => {
    const client = {
      send: async (command: string) => `handled:${command}`,
    };
    let recoveryCalls = 0;

    const wrapped = withAccessDeniedRecovery(client, () => {
      recoveryCalls += 1;
    });

    const result = await wrapped.send('DescribeInstancesCommand');
    assert.equal(result, 'handled:DescribeInstancesCommand');
    assert.equal(recoveryCalls, 0);
  });

  it('invalidates credentials and retries exactly once on AccessDenied', async () => {
    let attempts = 0;
    const client = {
      send: async (_command: string) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('not authorized');
          error.name = 'AccessDenied';
          throw error;
        }
        return 'recovered';
      },
    };
    let recoveryCalls = 0;

    const wrapped = withAccessDeniedRecovery(client, () => {
      recoveryCalls += 1;
    });

    const result = await wrapped.send('DescribeInstancesCommand');
    assert.equal(result, 'recovered');
    assert.equal(attempts, 2);
    assert.equal(recoveryCalls, 1);
  });

  it('propagates AccessDenied if it persists after one recovery attempt', async () => {
    let attempts = 0;
    const client = {
      send: async (_command: string) => {
        attempts += 1;
        const error = new Error('still not authorized');
        error.name = 'AccessDeniedException';
        throw error;
      },
    };
    let recoveryCalls = 0;

    const wrapped = withAccessDeniedRecovery(client, () => {
      recoveryCalls += 1;
    });

    await assert.rejects(() => wrapped.send('DescribeInstancesCommand'), /still not authorized/);
    assert.equal(attempts, 2);
    assert.equal(recoveryCalls, 1);
  });

  it('does not attempt recovery for non-AccessDenied errors', async () => {
    let attempts = 0;
    const client = {
      send: async (_command: string) => {
        attempts += 1;
        throw new Error('some other AWS error');
      },
    };
    let recoveryCalls = 0;

    const wrapped = withAccessDeniedRecovery(client, () => {
      recoveryCalls += 1;
    });

    await assert.rejects(() => wrapped.send('X'), /some other AWS error/);
    assert.equal(attempts, 1);
    assert.equal(recoveryCalls, 0);
  });
});
