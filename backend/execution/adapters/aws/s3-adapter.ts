import {
  GetBucketTaggingCommand,
  PutBucketTaggingCommand,
} from '@aws-sdk/client-s3';

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

const ACTIONS = ['PUT_BUCKET_TAGGING'] as const;

export class S3ExecutionAdapter extends BaseAwsExecutionAdapter {
  readonly service = 's3' as const;

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
    const tags = request.parameters?.tags;
    if (!tags || typeof tags !== 'object') {
      return {
        valid: false,
        checks: [],
        errors: [
          {
            code: 'INVALID_PARAMETERS',
            message: 'PUT_BUCKET_TAGGING requires parameters.tags.',
            stage: 'validate',
          },
        ],
      };
    }

    return {
      valid: true,
      checks: [`tenant:${context.tenantId}`, `bucket:${request.resourceId}`],
    };
  }

  buildDryRunPlan(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): DryRunPlan {
    return {
      service: 's3',
      action: 'PUT_BUCKET_TAGGING',
      resourceId: request.resourceId,
      region: context.region,
      parameters: request.parameters,
      reversible: true,
      steps: [
        `GetBucketTagging(${request.resourceId})`,
        `PutBucketTagging(${request.resourceId})`,
      ],
    };
  }

  async capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>> {
    const client = requireClient(this.clientFactory(context.region).s3, 'S3');
    try {
      const response = await client.send(
        new GetBucketTaggingCommand({ Bucket: request.resourceId }),
      );
      const tags = Object.fromEntries(
        (response.TagSet ?? []).map((tag) => [tag.Key ?? '', tag.Value ?? '']),
      );
      return { tags };
    } catch (error) {
      const mapped = mapAwsError(error, 'capture');
      if (mapped.awsErrorName === 'NoSuchTagSet') {
        return { tags: {} };
      }
      throw error;
    }
  }

  async execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    _previous: Record<string, unknown>,
  ): Promise<AdapterStepResult> {
    try {
      const client = requireClient(this.clientFactory(context.region).s3, 'S3');
      const tags = request.parameters?.tags as Record<string, string>;
      await client.send(
        new PutBucketTaggingCommand({
          Bucket: request.resourceId,
          Tagging: {
            TagSet: Object.entries(tags).map(([Key, Value]) => ({
              Key,
              Value,
            })),
          },
        }),
      );
      return { success: true, message: 'Bucket tags updated.' };
    } catch (error) {
      return {
        success: false,
        message: 'S3 execution failed.',
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
      const expected = request.parameters?.tags as Record<string, string>;
      const currentTags = (current.tags ?? {}) as Record<string, string>;
      const checks: string[] = [];

      for (const [key, value] of Object.entries(expected)) {
        checks.push(`tag:${key}`);
        if (currentTags[key] !== value) {
          return {
            verified: false,
            checks,
            error: {
              code: 'VERIFY_TAG_MISMATCH',
              message: `Bucket tag ${key} does not match.`,
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
      const client = requireClient(this.clientFactory(context.region).s3, 'S3');
      const tags = (previousConfiguration.tags ?? {}) as Record<string, string>;
      await client.send(
        new PutBucketTaggingCommand({
          Bucket: request.resourceId,
          Tagging: {
            TagSet: Object.entries(tags).map(([Key, Value]) => ({
              Key,
              Value,
            })),
          },
        }),
      );
      return {
        success: true,
        message: 'Restored previous bucket tags.',
        restoredConfiguration: previousConfiguration,
      };
    } catch (error) {
      return {
        success: false,
        message: 'S3 rollback failed.',
        error: mapAwsError(error, 'rollback'),
      };
    }
  }
}
