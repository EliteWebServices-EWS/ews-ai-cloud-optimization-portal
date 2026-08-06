import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';

import { StsCredentialProvider } from '../../execution/adapters/sts/sts-credential-provider';
import type { AwsAccountRoleConfig, StsAssumeRoleContext } from '../../execution/adapters/sts/sts-types';
import { withAccessDeniedRecovery } from '../../execution/adapters/sts/aws-service-client-factory';

import { createAwsCloudWatchEc2MetricsClient } from './aws-cloudwatch-ec2-metrics-client';
import type { Ec2PerformanceMetricsClientFactory } from './ec2-performance-metrics-client.port';

export interface Ec2CostCloudWatchFactoryDeps {
  credentialProvider: StsCredentialProvider;
  auditContext: StsAssumeRoleContext;
  tenantId: string;
  accountId: string;
}

export function createEc2CostCloudWatchClientFactory(
  roleConfig: AwsAccountRoleConfig,
  deps: Ec2CostCloudWatchFactoryDeps,
): Ec2PerformanceMetricsClientFactory {
  const { credentialProvider, auditContext, tenantId, accountId } = deps;
  const clientCache = new Map<string, ReturnType<typeof createAwsCloudWatchEc2MetricsClient>>();

  const credentials = async () => {
    const assumed = await credentialProvider.getCredentials(roleConfig, auditContext);
    return {
      accessKeyId: assumed.accessKeyId,
      secretAccessKey: assumed.secretAccessKey,
      sessionToken: assumed.sessionToken,
      expiration: assumed.expiration,
    };
  };

  const invalidate = () => credentialProvider.invalidate(roleConfig);

  return (region: string) => {
    const key = region.trim() || 'us-east-1';
    const cached = clientCache.get(key);
    if (cached) {
      return cached;
    }
    const cloudWatch = withAccessDeniedRecovery(
      new CloudWatchClient({ region: key, credentials }),
      invalidate,
    );
    const port = createAwsCloudWatchEc2MetricsClient(cloudWatch, { tenantId, accountId });
    clientCache.set(key, port);
    return port;
  };
}
