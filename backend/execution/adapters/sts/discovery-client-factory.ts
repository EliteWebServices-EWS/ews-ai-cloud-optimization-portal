import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { IAMClient, ListAccountAliasesCommand } from '@aws-sdk/client-iam';
import {
  DescribeOrganizationCommand,
  OrganizationsClient,
} from '@aws-sdk/client-organizations';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import type { AssumedCredentials } from './sts-types';
import type { AwsAccountDiscoveryApiClients } from './permission-validator';

export interface CreateDiscoveryClientsInput {
  region: string;
  credentials: Pick<
    AssumedCredentials,
    'accessKeyId' | 'secretAccessKey' | 'sessionToken'
  >;
}

export function createAwsAccountDiscoveryApiClients(
  input: CreateDiscoveryClientsInput,
): AwsAccountDiscoveryApiClients {
  const region = input.region.trim() || 'us-east-1';
  const credentialProvider = async () => ({
    accessKeyId: input.credentials.accessKeyId,
    secretAccessKey: input.credentials.secretAccessKey,
    sessionToken: input.credentials.sessionToken,
  });

  const sts = new STSClient({ region, credentials: credentialProvider });
  const ec2 = new EC2Client({ region, credentials: credentialProvider });
  const iam = new IAMClient({ region: 'us-east-1', credentials: credentialProvider });
  const organizations = new OrganizationsClient({
    region: 'us-east-1',
    credentials: credentialProvider,
  });

  return {
    async getCallerIdentity() {
      const response = await sts.send(new GetCallerIdentityCommand({}));
      if (!response.Account || !response.Arn) {
        throw new Error('GetCallerIdentity returned incomplete identity.');
      }
      return {
        accountId: response.Account,
        principalArn: response.Arn,
      };
    },
    async listAccountAliases() {
      const response = await iam.send(new ListAccountAliasesCommand({}));
      return response.AccountAliases ?? [];
    },
    async describeEnabledRegions() {
      const response = await ec2.send(
        new DescribeRegionsCommand({ AllRegions: false }),
      );
      return (response.Regions ?? [])
        .map((entry) => entry.RegionName)
        .filter((name): name is string => Boolean(name))
        .sort();
    },
    async describeOrganizationId() {
      try {
        const response = await organizations.send(new DescribeOrganizationCommand({}));
        return response.Organization?.Id;
      } catch (error) {
        const name = (error as { name?: string })?.name;
        if (
          name === 'AWSOrganizationsNotInUseException' ||
          name === 'OrganizationNotFoundException'
        ) {
          return undefined;
        }
        throw error;
      }
    },
  };
}
