import {
  DescribeAutoScalingGroupsCommand,
  UpdateAutoScalingGroupCommand,
} from '@aws-sdk/client-auto-scaling';

import { BaseAwsExecutionAdapter } from '../base-aws-adapter';
import { mapAwsError, requireClient } from '../aws-error-mapper';
import type { AwsExecutionClientFactory } from '../aws-clients';
import type {
  AdapterExecutionContext,
  AdapterExecutionRequest,
  AdapterStepResult,
  DryRunPlan,
  RollbackResult,
  ValidationResult,
  VerificationResult,
} from '../types';

const ACTIONS = ['UPDATE_DESIRED_CAPACITY'] as const;

export class AutoScalingExecutionAdapter extends BaseAwsExecutionAdapter {
  readonly service = 'autoscaling' as const;

  constructor(private readonly clientFactory: AwsExecutionClientFactory) {
    super();
  }

  supportedActions(): readonly string[] {
    return ACTIONS;
  }

  protected async validateRequest(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<ValidationResult> {
    const desired = Number(request.parameters?.desiredCapacity);
    const min = Number(request.parameters?.minCapacity ?? 0);
    const max = Number(request.parameters?.maxCapacity ?? desired);

    if (!Number.isInteger(desired) || desired < 0) {
      return {
        valid: false,
        checks: [],
        errors: [
          {
            code: 'INVALID_PARAMETERS',
            message: 'desiredCapacity must be a non-negative integer.',
            stage: 'validate',
          },
        ],
      };
    }

    if (desired < min || desired > max) {
      return {
        valid: false,
        checks: [],
        errors: [
          {
            code: 'CAPACITY_OUT_OF_BOUNDS',
            message: 'desiredCapacity must be within min/max bounds.',
            stage: 'validate',
          },
        ],
      };
    }

    try {
      const client = requireClient(
        this.clientFactory(context.region).autoScaling,
        'AutoScaling',
      );
      const response = await client.send(
        new DescribeAutoScalingGroupsCommand({
          AutoScalingGroupNames: [request.resourceId],
        }),
      );
      const group = response.AutoScalingGroups?.[0];
      if (!group) {
        return {
          valid: false,
          checks: [`tenant:${context.tenantId}`],
          errors: [
            {
              code: 'RESOURCE_NOT_FOUND',
              message: `Auto Scaling group ${request.resourceId} was not found.`,
              stage: 'validate',
            },
          ],
        };
      }

      return {
        valid: true,
        checks: [`asg:${group.AutoScalingGroupName}`, `desired:${desired}`],
      };
    } catch (error) {
      return {
        valid: false,
        checks: [],
        errors: [mapAwsError(error, 'validate')],
      };
    }
  }

  buildDryRunPlan(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): DryRunPlan {
    return {
      service: 'autoscaling',
      action: 'UPDATE_DESIRED_CAPACITY',
      resourceId: request.resourceId,
      region: context.region,
      parameters: request.parameters,
      reversible: true,
      steps: [
        `DescribeAutoScalingGroups(${request.resourceId})`,
        `UpdateAutoScalingGroup(desiredCapacity=${request.parameters?.desiredCapacity})`,
      ],
    };
  }

  async capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>> {
    const client = requireClient(
      this.clientFactory(context.region).autoScaling,
      'AutoScaling',
    );
    const response = await client.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [request.resourceId],
      }),
    );
    const group = response.AutoScalingGroups?.[0];
    return {
      desiredCapacity: group?.DesiredCapacity ?? 0,
      minSize: group?.MinSize ?? 0,
      maxSize: group?.MaxSize ?? 0,
    };
  }

  async execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    _previous: Record<string, unknown>,
  ): Promise<AdapterStepResult> {
    try {
      const client = requireClient(
        this.clientFactory(context.region).autoScaling,
        'AutoScaling',
      );
      await client.send(
        new UpdateAutoScalingGroupCommand({
          AutoScalingGroupName: request.resourceId,
          DesiredCapacity: Number(request.parameters?.desiredCapacity),
        }),
      );
      return { success: true, message: 'Desired capacity update requested.' };
    } catch (error) {
      return {
        success: false,
        message: 'Auto Scaling execution failed.',
        error: mapAwsError(error, 'execute'),
      };
    }
  }

  async verify(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    _previous: Record<string, unknown>,
    _output: Record<string, unknown> | undefined,
  ): Promise<VerificationResult> {
    try {
      const current = await this.capturePreviousConfiguration(context, request);
      const expected = Number(request.parameters?.desiredCapacity);
      const actual = Number(current.desiredCapacity);
      const verified = actual === expected;
      return {
        verified,
        checks: [`desiredCapacity:${actual}`],
        error: verified
          ? undefined
          : {
              code: 'VERIFY_CAPACITY_MISMATCH',
              message: 'Desired capacity does not match expected value.',
              stage: 'verify',
            },
      };
    } catch (error) {
      return {
        verified: false,
        checks: [],
        error: mapAwsError(error, 'verify'),
      };
    }
  }

  async rollback(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
  ): Promise<RollbackResult> {
    try {
      const client = requireClient(
        this.clientFactory(context.region).autoScaling,
        'AutoScaling',
      );
      await client.send(
        new UpdateAutoScalingGroupCommand({
          AutoScalingGroupName: request.resourceId,
          DesiredCapacity: Number(previousConfiguration.desiredCapacity),
        }),
      );
      return {
        success: true,
        message: 'Restored previous desired capacity.',
        restoredConfiguration: previousConfiguration,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Auto Scaling rollback failed.',
        error: mapAwsError(error, 'rollback'),
      };
    }
  }
}
