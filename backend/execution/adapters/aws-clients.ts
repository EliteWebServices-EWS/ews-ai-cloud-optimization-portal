import type { EC2Client } from '@aws-sdk/client-ec2';
import type { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import type { RDSClient } from '@aws-sdk/client-rds';
import type { S3Client } from '@aws-sdk/client-s3';
import type { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import type { LambdaClient } from '@aws-sdk/client-lambda';

export interface AwsExecutionClients {
  ec2?: EC2Client;
  autoScaling?: AutoScalingClient;
  rds?: RDSClient;
  s3?: S3Client;
  cloudFront?: CloudFrontClient;
  lambda?: LambdaClient;
}

export type AwsExecutionClientFactory = (
  region: string,
) => AwsExecutionClients;

export function createRegionalClientStub(
  factory: AwsExecutionClientFactory,
): AwsExecutionClientFactory {
  const cache = new Map<string, AwsExecutionClients>();

  return (region: string) => {
    const key = region.trim() || 'us-east-1';
    let clients = cache.get(key);
    if (!clients) {
      clients = factory(key);
      cache.set(key, clients);
    }
    return clients;
  };
}
