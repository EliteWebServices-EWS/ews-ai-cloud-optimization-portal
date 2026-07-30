import type { ExecutionAdapter } from '../../execution/adapters/types';
import type { AwsExecutionClientFactory } from '../../execution/adapters/aws-clients';

export function awsError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export interface AdapterContractCase {
  name: string;
  factory: AwsExecutionClientFactory;
  request: {
    service: ExecutionAdapter['service'];
    action: string;
    resourceId: string;
    parameters?: Record<string, unknown>;
  };
  expectValid: boolean;
}

export const ADAPTER_SERVICES: ExecutionAdapter['service'][] = [
  'ec2',
  'autoscaling',
  'rds',
  's3',
  'cloudfront',
  'lambda',
];
