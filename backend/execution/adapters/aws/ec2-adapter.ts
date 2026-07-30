import {
  CreateTagsCommand,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';

import { BaseAwsExecutionAdapter } from '../base-aws-adapter';
import { mapAwsError, requireClient } from '../aws-error-mapper';
import type { AwsExecutionClients, AwsExecutionClientFactory } from '../aws-clients';
import type {
  AdapterExecutionContext,
  AdapterExecutionRequest,
  AdapterStepResult,
  DryRunPlan,
  RollbackResult,
  ValidationResult,
  VerificationResult,
} from '../types';

const ACTIONS = [
  'START_INSTANCE',
  'STOP_INSTANCE',
  'UPDATE_TAGS',
] as const;

function normalizeAction(action: string): (typeof ACTIONS)[number] {
  return action.trim().toUpperCase() as (typeof ACTIONS)[number];
}

export class Ec2ExecutionAdapter extends BaseAwsExecutionAdapter {
  readonly service = 'ec2' as const;

  constructor(private readonly clientFactory: AwsExecutionClientFactory) {
    super();
  }

  supportedActions(): readonly string[] {
    return ACTIONS;
  }

  private clients(region: string): AwsExecutionClients {
    return this.clientFactory(region);
  }

  protected async validateRequest(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<ValidationResult> {
    const action = normalizeAction(request.action);
    const checks = [`tenant:${context.tenantId}`, `action:${action}`];

    if (action === 'UPDATE_TAGS') {
      const tags = request.parameters?.tags;
      if (!tags || typeof tags !== 'object') {
        return {
          valid: false,
          checks,
          errors: [
            {
              code: 'INVALID_PARAMETERS',
              message: 'UPDATE_TAGS requires parameters.tags object.',
              stage: 'validate',
            },
          ],
        };
      }
    }

    try {
      const ec2 = requireClient(this.clients(context.region).ec2, 'EC2');
      const response = await ec2.send(
        new DescribeInstancesCommand({
          InstanceIds: [request.resourceId],
        }),
      );
      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (!instance?.InstanceId) {
        return {
          valid: false,
          checks,
          errors: [
            {
              code: 'RESOURCE_NOT_FOUND',
              message: `EC2 instance ${request.resourceId} was not found.`,
              stage: 'validate',
            },
          ],
        };
      }

      checks.push('describe_instances:ok');
      return { valid: true, checks };
    } catch (error) {
      return {
        valid: false,
        checks,
        errors: [mapAwsError(error, 'validate')],
      };
    }
  }

  buildDryRunPlan(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): DryRunPlan {
    const action = normalizeAction(request.action);
    return {
      service: 'ec2',
      action,
      resourceId: request.resourceId,
      region: context.region,
      parameters: request.parameters,
      reversible: action !== 'START_INSTANCE' || true,
      steps: [`DescribeInstances(${request.resourceId})`, `${action}(${request.resourceId})`],
      rollbackNotes:
        action === 'START_INSTANCE'
          ? 'Rollback stops the instance if it was stopped before execution.'
          : undefined,
    };
  }

  async capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>> {
    const ec2 = requireClient(this.clients(context.region).ec2, 'EC2');
    const response = await ec2.send(
      new DescribeInstancesCommand({
        InstanceIds: [request.resourceId],
      }),
    );
    const instance = response.Reservations?.[0]?.Instances?.[0];
    return {
      state: instance?.State?.Name ?? 'unknown',
      tags: Object.fromEntries(
        (instance?.Tags ?? []).map((tag) => [tag.Key ?? '', tag.Value ?? '']),
      ),
    };
  }

  async execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    _previousConfiguration: Record<string, unknown>,
  ): Promise<AdapterStepResult> {
    const action = normalizeAction(request.action);
    const ec2 = requireClient(this.clients(context.region).ec2, 'EC2');

    try {
      if (action === 'START_INSTANCE') {
        await ec2.send(
          new StartInstancesCommand({ InstanceIds: [request.resourceId] }),
        );
        return { success: true, message: 'Instance start requested.' };
      }

      if (action === 'STOP_INSTANCE') {
        await ec2.send(
          new StopInstancesCommand({ InstanceIds: [request.resourceId] }),
        );
        return { success: true, message: 'Instance stop requested.' };
      }

      const tags = request.parameters?.tags as Record<string, string>;
      await ec2.send(
        new CreateTagsCommand({
          Resources: [request.resourceId],
          Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        }),
      );
      return { success: true, message: 'Instance tags updated.' };
    } catch (error) {
      return {
        success: false,
        message: 'EC2 execution failed.',
        error: mapAwsError(error, 'execute'),
      };
    }
  }

  async verify(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
    _executionOutput: Record<string, unknown> | undefined,
  ): Promise<VerificationResult> {
    const action = normalizeAction(request.action);
    try {
      const current = await this.capturePreviousConfiguration(context, request);
      const checks: string[] = [];

      if (action === 'START_INSTANCE') {
        const ok = current.state === 'running' || current.state === 'pending';
        checks.push(`state:${String(current.state)}`);
        return {
          verified: ok,
          checks,
          error: ok
            ? undefined
            : {
                code: 'VERIFY_STATE_MISMATCH',
                message: 'Instance is not running after start.',
                stage: 'verify',
              },
        };
      }

      if (action === 'STOP_INSTANCE') {
        const ok =
          current.state === 'stopped' ||
          current.state === 'stopping' ||
          current.state === 'stopped';
        checks.push(`state:${String(current.state)}`);
        return {
          verified: ok,
          checks,
          error: ok
            ? undefined
            : {
                code: 'VERIFY_STATE_MISMATCH',
                message: 'Instance is not stopped after stop.',
                stage: 'verify',
              },
        };
      }

      const previousTags = (previousConfiguration.tags ?? {}) as Record<
        string,
        string
      >;
      const currentTags = (current.tags ?? {}) as Record<string, string>;
      const expected = request.parameters?.tags as Record<string, string>;
      for (const [key, value] of Object.entries(expected)) {
        checks.push(`tag:${key}`);
        if (currentTags[key] !== value) {
          return {
            verified: false,
            checks,
            error: {
              code: 'VERIFY_TAG_MISMATCH',
              message: `Tag ${key} was not applied.`,
              stage: 'verify',
            },
          };
        }
      }

      void previousTags;
      return { verified: true, checks };
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
    const action = normalizeAction(request.action);
    const previousState = String(previousConfiguration.state ?? '');

    try {
      if (action === 'UPDATE_TAGS') {
        const previousTags = (previousConfiguration.tags ?? {}) as Record<
          string,
          string
        >;
        const ec2 = requireClient(this.clients(context.region).ec2, 'EC2');
        await ec2.send(
          new CreateTagsCommand({
            Resources: [request.resourceId],
            Tags: Object.entries(previousTags).map(([Key, Value]) => ({
              Key,
              Value,
            })),
          }),
        );
        return {
          success: true,
          message: 'Restored previous EC2 tags.',
          restoredConfiguration: previousConfiguration,
        };
      }

      if (action === 'START_INSTANCE' && previousState === 'stopped') {
        const result = await this.execute(context, {
          ...request,
          action: 'STOP_INSTANCE',
        }, previousConfiguration);
        return {
          success: result.success,
          message: result.message,
          restoredConfiguration: previousConfiguration,
          error: result.error,
        };
      }

      if (action === 'STOP_INSTANCE' && previousState === 'running') {
        const result = await this.execute(context, {
          ...request,
          action: 'START_INSTANCE',
        }, previousConfiguration);
        return {
          success: result.success,
          message: result.message,
          restoredConfiguration: previousConfiguration,
          error: result.error,
        };
      }

      return {
        success: false,
        message: 'Rollback not applicable for current EC2 state transition.',
        nonReversible: true,
        reason: `Cannot safely revert ${action} from state ${previousState}.`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'EC2 rollback failed.',
        error: mapAwsError(error, 'rollback'),
      };
    }
  }
}
