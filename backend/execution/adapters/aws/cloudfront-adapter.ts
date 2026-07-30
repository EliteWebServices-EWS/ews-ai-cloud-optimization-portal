import {
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  type DistributionConfig,
} from '@aws-sdk/client-cloudfront';

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

const ACTIONS = ['UPDATE_COMMENT'] as const;

export class CloudFrontExecutionAdapter extends BaseAwsExecutionAdapter {
  readonly service = 'cloudfront' as const;

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
    const comment = request.parameters?.comment;
    if (typeof comment !== 'string' || !comment.trim()) {
      return {
        valid: false,
        checks: [],
        errors: [
          {
            code: 'INVALID_PARAMETERS',
            message: 'UPDATE_COMMENT requires parameters.comment string.',
            stage: 'validate',
          },
        ],
      };
    }

    try {
      const client = requireClient(
        this.clientFactory(context.region).cloudFront,
        'CloudFront',
      );
      await client.send(
        new GetDistributionConfigCommand({ Id: request.resourceId }),
      );
      return {
        valid: true,
        checks: [`tenant:${context.tenantId}`, `distribution:${request.resourceId}`],
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
      service: 'cloudfront',
      action: 'UPDATE_COMMENT',
      resourceId: request.resourceId,
      region: context.region,
      parameters: request.parameters,
      reversible: true,
      steps: [
        `GetDistributionConfig(${request.resourceId})`,
        `UpdateDistribution(comment)`,
      ],
      rollbackNotes: 'Uses distribution ETag for conditional update.',
    };
  }

  async capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>> {
    const client = requireClient(
      this.clientFactory(context.region).cloudFront,
      'CloudFront',
    );
    const response = await client.send(
      new GetDistributionConfigCommand({ Id: request.resourceId }),
    );
    return {
      comment: response.DistributionConfig?.Comment ?? '',
      eTag: response.ETag ?? '',
      distributionConfig: response.DistributionConfig,
    };
  }

  async execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
  ): Promise<AdapterStepResult> {
    try {
      const client = requireClient(
        this.clientFactory(context.region).cloudFront,
        'CloudFront',
      );
      const config = previousConfiguration.distributionConfig as
        | DistributionConfig
        | undefined;

      if (!config) {
        return {
          success: false,
          message: 'Missing distribution configuration snapshot.',
          error: {
            code: 'MISSING_SNAPSHOT',
            message: 'Distribution config snapshot is required.',
            stage: 'execute',
          },
        };
      }

      const updatedConfig = {
        ...config,
        Comment: String(request.parameters?.comment),
      };

      const response = await client.send(
        new UpdateDistributionCommand({
          Id: request.resourceId,
          IfMatch: String(previousConfiguration.eTag),
          DistributionConfig: updatedConfig,
        }),
      );

      return {
        success: true,
        message: 'CloudFront distribution comment updated.',
        output: { eTag: response.ETag },
      };
    } catch (error) {
      return {
        success: false,
        message: 'CloudFront execution failed.',
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
      const expected = String(request.parameters?.comment);
      const verified = String(current.comment) === expected;
      return {
        verified,
        checks: [`comment:${String(current.comment)}`],
        error: verified
          ? undefined
          : {
              code: 'VERIFY_COMMENT_MISMATCH',
              message: 'Distribution comment does not match expected value.',
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
        this.clientFactory(context.region).cloudFront,
        'CloudFront',
      );
      const config = previousConfiguration.distributionConfig as
        | DistributionConfig
        | undefined;
      if (!config) {
        return {
          success: false,
          message: 'Missing distribution config for rollback.',
          nonReversible: true,
        };
      }

      const current = await this.capturePreviousConfiguration(context, request);
      await client.send(
        new UpdateDistributionCommand({
          Id: request.resourceId,
          IfMatch: String(current.eTag),
          DistributionConfig: {
            ...config,
            Comment: String(previousConfiguration.comment ?? ''),
          },
        }),
      );

      return {
        success: true,
        message: 'Restored CloudFront distribution comment.',
        restoredConfiguration: previousConfiguration,
      };
    } catch (error) {
      return {
        success: false,
        message: 'CloudFront rollback failed.',
        error: mapAwsError(error, 'rollback'),
      };
    }
  }
}
