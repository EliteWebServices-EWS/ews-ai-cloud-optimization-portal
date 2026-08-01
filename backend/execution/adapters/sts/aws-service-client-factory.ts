import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { EC2Client } from '@aws-sdk/client-ec2';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';

import type {
  AwsExecutionClientFactory,
  AwsExecutionClients,
} from '../aws-clients';

import { StsCredentialProvider } from './sts-credential-provider';
import type { AwsAccountRoleConfig, StsAssumeRoleContext } from './sts-types';

interface AccessDeniedLike {
  name?: string;
}

function isAccessDenied(error: unknown): boolean {
  const name = (error as AccessDeniedLike)?.name;
  return name === 'AccessDenied' || name === 'AccessDeniedException';
}

/**
 * Wraps an SDK client's send() so that a downstream AccessDenied — which can
 * happen if the trust policy or grants changed mid-session, or IAM's
 * eventual-consistency window hasn't caught up yet — evicts the cached
 * AssumeRole credentials and retries the same call exactly once with a
 * freshly assumed session, instead of failing immediately.
 *
 * This is implemented entirely here so the execution adapters (ec2-adapter.ts
 * etc.) are unmodified: they only ever see a plain client with a send()
 * method, exactly as the AwsExecutionClients type promises.
 */
interface SendCapable {
  send: (...args: unknown[]) => Promise<unknown>;
}

export function withAccessDeniedRecovery<T>(
  client: T,
  onAccessDenied: () => void,
): T {
  // SDK clients declare send() as a generic overloaded method, which cannot
  // structurally satisfy a plain function-typed constraint — the `T extends
  // SendCapable` form fails variance checks at every call site even though
  // the runtime shape is exactly right. Leaving T unconstrained and going
  // through `unknown` confines the unsafe cast to this one patch site while
  // every call site and the public signature above stay fully typed.
  const target = client as unknown as SendCapable;
  const originalSend = target.send.bind(target);
  let recoveredOnce = false;

  const wrappedSend: SendCapable['send'] = async (...args: unknown[]) => {
    try {
      const result = await originalSend(...args);
      recoveredOnce = false;
      return result;
    } catch (error) {
      if (isAccessDenied(error) && !recoveredOnce) {
        recoveredOnce = true;
        onAccessDenied();
        try {
          return await originalSend(...args);
        } finally {
          recoveredOnce = false;
        }
      }
      throw error;
    }
  };

  target.send = wrappedSend;

  return client;
}

export interface AssumeRoleClientFactoryDeps {
  credentialProvider: StsCredentialProvider;
  auditContext: StsAssumeRoleContext;
}

/**
 * Produces an AwsExecutionClientFactory — the exact same type the AWS
 * execution adapters (ec2-adapter.ts, s3-adapter.ts, etc.) already accept —
 * backed by STS AssumeRole credentials for one tenant's AWS account. The
 * adapters themselves require no changes.
 */
export function createAssumeRoleClientFactory(
  config: AwsAccountRoleConfig,
  deps: AssumeRoleClientFactoryDeps,
): AwsExecutionClientFactory {
  const { credentialProvider, auditContext } = deps;
  const regionCache = new Map<string, AwsExecutionClients>();

  const credentials = async () => {
    const assumed = await credentialProvider.getCredentials(config, auditContext);
    return {
      accessKeyId: assumed.accessKeyId,
      secretAccessKey: assumed.secretAccessKey,
      sessionToken: assumed.sessionToken,
      expiration: assumed.expiration,
    };
  };

  const invalidateAndRefresh = () => credentialProvider.invalidate(config);

  return (region: string): AwsExecutionClients => {
    const key = region.trim() || 'us-east-1';
    const cached = regionCache.get(key);
    if (cached) {
      return cached;
    }

    const clients: AwsExecutionClients = {
      ec2: withAccessDeniedRecovery(
        new EC2Client({ region: key, credentials }),
        invalidateAndRefresh,
      ),
      autoScaling: withAccessDeniedRecovery(
        new AutoScalingClient({ region: key, credentials }),
        invalidateAndRefresh,
      ),
      rds: withAccessDeniedRecovery(
        new RDSClient({ region: key, credentials }),
        invalidateAndRefresh,
      ),
      s3: withAccessDeniedRecovery(
        new S3Client({ region: key, credentials }),
        invalidateAndRefresh,
      ),
      cloudFront: withAccessDeniedRecovery(
        new CloudFrontClient({ region: key, credentials }),
        invalidateAndRefresh,
      ),
      lambda: withAccessDeniedRecovery(
        new LambdaClient({ region: key, credentials }),
        invalidateAndRefresh,
      ),
    };

    regionCache.set(key, clients);
    return clients;
  };
}
