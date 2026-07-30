import {
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';

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

const ACTIONS = ['UPDATE_FUNCTION_CONFIGURATION'] as const;

export class LambdaExecutionAdapter extends BaseAwsExecutionAdapter {
  readonly service = 'lambda' as const;

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
    const memory = request.parameters?.memorySize;
    const timeout = request.parameters?.timeout;

    if (memory !== undefined) {
      const value = Number(memory);
      if (!Number.isInteger(value) || value < 128 || value > 10240) {
        return {
          valid: false,
          checks: [],
          errors: [
            {
              code: 'INVALID_PARAMETERS',
              message: 'memorySize must be an integer between 128 and 10240.',
              stage: 'validate',
            },
          ],
        };
      }
    }

    if (timeout !== undefined) {
      const value = Number(timeout);
      if (!Number.isInteger(value) || value < 1 || value > 900) {
        return {
          valid: false,
          checks: [],
          errors: [
            {
              code: 'INVALID_PARAMETERS',
              message: 'timeout must be an integer between 1 and 900.',
              stage: 'validate',
            },
          ],
        };
      }
    }

    if (memory === undefined && timeout === undefined) {
      return {
        valid: false,
        checks: [],
        errors: [
          {
            code: 'INVALID_PARAMETERS',
            message: 'Provide memorySize and/or timeout.',
            stage: 'validate',
          },
        ],
      };
    }

    try {
      const client = requireClient(
        this.clientFactory(context.region).lambda,
        'Lambda',
      );
      await client.send(
        new GetFunctionConfigurationCommand({
          FunctionName: request.resourceId,
        }),
      );
      return {
        valid: true,
        checks: [`tenant:${context.tenantId}`, `function:${request.resourceId}`],
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
      service: 'lambda',
      action: 'UPDATE_FUNCTION_CONFIGURATION',
      resourceId: request.resourceId,
      region: context.region,
      parameters: request.parameters,
      reversible: true,
      steps: [
        `GetFunctionConfiguration(${request.resourceId})`,
        'UpdateFunctionConfiguration',
      ],
    };
  }

  async capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>> {
    const client = requireClient(
      this.clientFactory(context.region).lambda,
      'Lambda',
    );
    const response = await client.send(
      new GetFunctionConfigurationCommand({
        FunctionName: request.resourceId,
      }),
    );
    return {
      memorySize: response.MemorySize,
      timeout: response.Timeout,
    };
  }

  async execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    _previous: Record<string, unknown>,
  ): Promise<AdapterStepResult> {
    try {
      const client = requireClient(
        this.clientFactory(context.region).lambda,
        'Lambda',
      );
      await client.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: request.resourceId,
          MemorySize:
            request.parameters?.memorySize !== undefined
              ? Number(request.parameters.memorySize)
              : undefined,
          Timeout:
            request.parameters?.timeout !== undefined
              ? Number(request.parameters.timeout)
              : undefined,
        }),
      );
      return { success: true, message: 'Lambda configuration updated.' };
    } catch (error) {
      return {
        success: false,
        message: 'Lambda execution failed.',
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
      const checks: string[] = [];

      if (request.parameters?.memorySize !== undefined) {
        const expected = Number(request.parameters.memorySize);
        const actual = Number(current.memorySize);
        checks.push(`memorySize:${actual}`);
        if (actual !== expected) {
          return {
            verified: false,
            checks,
            error: {
              code: 'VERIFY_LAMBDA_CONFIG_MISMATCH',
              message: 'Lambda memorySize does not match.',
              stage: 'verify',
            },
          };
        }
      }

      if (request.parameters?.timeout !== undefined) {
        const expected = Number(request.parameters.timeout);
        const actual = Number(current.timeout);
        checks.push(`timeout:${actual}`);
        if (actual !== expected) {
          return {
            verified: false,
            checks,
            error: {
              code: 'VERIFY_LAMBDA_CONFIG_MISMATCH',
              message: 'Lambda timeout does not match.',
              stage: 'verify',
            },
          };
        }
      }

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
    try {
      const client = requireClient(
        this.clientFactory(context.region).lambda,
        'Lambda',
      );
      await client.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: request.resourceId,
          MemorySize:
            previousConfiguration.memorySize !== undefined
              ? Number(previousConfiguration.memorySize)
              : undefined,
          Timeout:
            previousConfiguration.timeout !== undefined
              ? Number(previousConfiguration.timeout)
              : undefined,
        }),
      );
      return {
        success: true,
        message: 'Restored Lambda configuration.',
        restoredConfiguration: previousConfiguration,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Lambda rollback failed.',
        error: mapAwsError(error, 'rollback'),
      };
    }
  }
}
