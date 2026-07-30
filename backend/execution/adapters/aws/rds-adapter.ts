import {
  DescribeDBInstancesCommand,
  ModifyDBInstanceCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
} from '@aws-sdk/client-rds';

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

const ACTIONS = [
  'MODIFY_BACKUP_RETENTION',
  'START_INSTANCE',
  'STOP_INSTANCE',
] as const;

export class RdsExecutionAdapter extends BaseAwsExecutionAdapter {
  readonly service = 'rds' as const;

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
    const action = request.action.trim().toUpperCase();
    if (action === 'MODIFY_BACKUP_RETENTION') {
      const retention = Number(request.parameters?.backupRetentionPeriod);
      if (!Number.isInteger(retention) || retention < 0 || retention > 35) {
        return {
          valid: false,
          checks: [],
          errors: [
            {
              code: 'INVALID_PARAMETERS',
              message: 'backupRetentionPeriod must be an integer between 0 and 35.',
              stage: 'validate',
            },
          ],
        };
      }
    }

    try {
      const client = requireClient(this.clientFactory(context.region).rds, 'RDS');
      const response = await client.send(
        new DescribeDBInstancesCommand({
          DBInstanceIdentifier: request.resourceId,
        }),
      );
      if (!response.DBInstances?.[0]) {
        return {
          valid: false,
          checks: [],
          errors: [
            {
              code: 'RESOURCE_NOT_FOUND',
              message: `RDS instance ${request.resourceId} was not found.`,
              stage: 'validate',
            },
          ],
        };
      }

      return { valid: true, checks: [`tenant:${context.tenantId}`, `action:${action}`] };
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
      service: 'rds',
      action: request.action.trim().toUpperCase(),
      resourceId: request.resourceId,
      region: context.region,
      parameters: request.parameters,
      reversible: request.action.trim().toUpperCase() !== 'STOP_INSTANCE',
      steps: [
        `DescribeDBInstances(${request.resourceId})`,
        `${request.action}(${request.resourceId})`,
      ],
    };
  }

  async capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>> {
    const client = requireClient(this.clientFactory(context.region).rds, 'RDS');
    const response = await client.send(
      new DescribeDBInstancesCommand({
        DBInstanceIdentifier: request.resourceId,
      }),
    );
    const db = response.DBInstances?.[0];
    return {
      status: db?.DBInstanceStatus ?? 'unknown',
      backupRetentionPeriod: db?.BackupRetentionPeriod ?? 0,
    };
  }

  async execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    _previous: Record<string, unknown>,
  ): Promise<AdapterStepResult> {
    const action = request.action.trim().toUpperCase();
    const client = requireClient(this.clientFactory(context.region).rds, 'RDS');

    try {
      if (action === 'MODIFY_BACKUP_RETENTION') {
        await client.send(
          new ModifyDBInstanceCommand({
            DBInstanceIdentifier: request.resourceId,
            BackupRetentionPeriod: Number(
              request.parameters?.backupRetentionPeriod,
            ),
            ApplyImmediately: true,
          }),
        );
        return { success: true, message: 'Backup retention updated.' };
      }

      if (action === 'START_INSTANCE') {
        await client.send(
          new StartDBInstanceCommand({
            DBInstanceIdentifier: request.resourceId,
          }),
        );
        return { success: true, message: 'RDS start requested.' };
      }

      await client.send(
        new StopDBInstanceCommand({
          DBInstanceIdentifier: request.resourceId,
        }),
      );
      return { success: true, message: 'RDS stop requested.' };
    } catch (error) {
      return {
        success: false,
        message: 'RDS execution failed.',
        error: mapAwsError(error, 'execute'),
      };
    }
  }

  async verify(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
    _output: Record<string, unknown> | undefined,
  ): Promise<VerificationResult> {
    try {
      const current = await this.capturePreviousConfiguration(context, request);
      const action = request.action.trim().toUpperCase();

      if (action === 'MODIFY_BACKUP_RETENTION') {
        const expected = Number(request.parameters?.backupRetentionPeriod);
        const actual = Number(current.backupRetentionPeriod);
        const verified = actual === expected;
        return {
          verified,
          checks: [`backupRetentionPeriod:${actual}`],
          error: verified
            ? undefined
            : {
                code: 'VERIFY_RDS_CONFIG_MISMATCH',
                message: 'Backup retention does not match expected value.',
                stage: 'verify',
              },
        };
      }

      if (action === 'START_INSTANCE') {
        const verified =
          current.status === 'available' || current.status === 'starting';
        return {
          verified,
          checks: [`status:${String(current.status)}`],
        };
      }

      const verified =
        current.status === 'stopped' || current.status === 'stopping';
      void previousConfiguration;
      return {
        verified,
        checks: [`status:${String(current.status)}`],
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
    const action = request.action.trim().toUpperCase();

    if (action === 'STOP_INSTANCE') {
      return {
        success: false,
        message: 'RDS stop is non-reversible via automated rollback.',
        nonReversible: true,
        reason: 'Starting a stopped RDS instance may require manual validation.',
      };
    }

    try {
      const client = requireClient(this.clientFactory(context.region).rds, 'RDS');
      if (action === 'MODIFY_BACKUP_RETENTION') {
        await client.send(
          new ModifyDBInstanceCommand({
            DBInstanceIdentifier: request.resourceId,
            BackupRetentionPeriod: Number(
              previousConfiguration.backupRetentionPeriod,
            ),
            ApplyImmediately: true,
          }),
        );
        return {
          success: true,
          message: 'Restored backup retention period.',
          restoredConfiguration: previousConfiguration,
        };
      }

      if (action === 'START_INSTANCE' && previousConfiguration.status === 'stopped') {
        await client.send(
          new StopDBInstanceCommand({
            DBInstanceIdentifier: request.resourceId,
          }),
        );
        return {
          success: true,
          message: 'Stopped RDS instance after failed start rollback.',
          restoredConfiguration: previousConfiguration,
        };
      }

      return {
        success: false,
        message: 'Rollback not applicable.',
        nonReversible: true,
      };
    } catch (error) {
      return {
        success: false,
        message: 'RDS rollback failed.',
        error: mapAwsError(error, 'rollback'),
      };
    }
  }
}
