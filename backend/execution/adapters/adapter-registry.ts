import type { AwsExecutionService } from '../../repositories/models/execution-run-models';
import type { AwsExecutionClientFactory } from './aws-clients';
import { AutoScalingExecutionAdapter } from './aws/autoscaling-adapter';
import { CloudFrontExecutionAdapter } from './aws/cloudfront-adapter';
import { Ec2ExecutionAdapter } from './aws/ec2-adapter';
import { LambdaExecutionAdapter } from './aws/lambda-adapter';
import { RdsExecutionAdapter } from './aws/rds-adapter';
import { S3ExecutionAdapter } from './aws/s3-adapter';
import {
  ExecutionAdapterError,
  type ExecutionAdapter,
  unsupportedOperation,
} from './types';

export interface ExecutionAdapterRegistry {
  resolve(service: AwsExecutionService): ExecutionAdapter;
  isSupported(service: AwsExecutionService, action: string): boolean;
  listServices(): AwsExecutionService[];
}

export function createDefaultExecutionAdapterRegistry(
  clientFactory: AwsExecutionClientFactory,
  overrides: Partial<Record<AwsExecutionService, ExecutionAdapter>> = {},
): ExecutionAdapterRegistry {
  const adapters: Record<AwsExecutionService, ExecutionAdapter> = {
    ec2: overrides.ec2 ?? new Ec2ExecutionAdapter(clientFactory),
    autoscaling:
      overrides.autoscaling ??
      new AutoScalingExecutionAdapter(clientFactory),
    rds: overrides.rds ?? new RdsExecutionAdapter(clientFactory),
    s3: overrides.s3 ?? new S3ExecutionAdapter(clientFactory),
    cloudfront:
      overrides.cloudfront ?? new CloudFrontExecutionAdapter(clientFactory),
    lambda: overrides.lambda ?? new LambdaExecutionAdapter(clientFactory),
  };

  return {
    resolve(service: AwsExecutionService): ExecutionAdapter {
      const adapter = adapters[service];
      if (!adapter) {
        throw new ExecutionAdapterError(
          'UNKNOWN_SERVICE',
          `Unknown execution service: ${service}`,
          'resolve',
        );
      }
      return adapter;
    },
    isSupported(service: AwsExecutionService, action: string): boolean {
      const adapter = adapters[service];
      if (!adapter) {
        return false;
      }
      return adapter.supportedActions().includes(action.trim().toUpperCase());
    },
    listServices(): AwsExecutionService[] {
      return Object.keys(adapters) as AwsExecutionService[];
    },
  };
}

export function rejectUnsupportedAction(
  service: AwsExecutionService,
  action: string,
  registry: ExecutionAdapterRegistry,
) {
  if (!registry.isSupported(service, action)) {
    return unsupportedOperation(
      service,
      action,
      `Action ${action} is not supported for service ${service}.`,
    );
  }
  return undefined;
}
