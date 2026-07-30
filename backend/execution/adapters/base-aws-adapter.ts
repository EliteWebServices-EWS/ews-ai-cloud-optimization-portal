import {
  ExecutionAdapterError,
  type AdapterExecutionContext,
  type AdapterExecutionRequest,
  type DryRunPlan,
  type ExecutionAdapter,
  type ValidationResult,
} from './types';

export abstract class BaseAwsExecutionAdapter implements ExecutionAdapter {
  abstract readonly service: ExecutionAdapter['service'];

  abstract supportedActions(): readonly string[];

  protected assertTenantContext(context: AdapterExecutionContext): void {
    if (!context.tenantId?.trim()) {
      throw new ExecutionAdapterError(
        'TENANT_REQUIRED',
        'Tenant ID is required for execution.',
        'validate',
      );
    }
    if (!context.actorId?.trim()) {
      throw new ExecutionAdapterError(
        'ACTOR_REQUIRED',
        'Actor identity is required for execution.',
        'validate',
      );
    }
    if (!context.region?.trim()) {
      throw new ExecutionAdapterError(
        'REGION_REQUIRED',
        'AWS region is required.',
        'validate',
      );
    }
  }

  protected assertSupportedAction(request: AdapterExecutionRequest): void {
    const action = request.action.trim().toUpperCase();
    if (!this.supportedActions().includes(action)) {
      throw new ExecutionAdapterError(
        'UNSUPPORTED_ACTION',
        `Action ${action} is not supported for ${this.service}.`,
        'validate',
      );
    }
    if (!request.resourceId?.trim()) {
      throw new ExecutionAdapterError(
        'RESOURCE_ID_REQUIRED',
        'Resource identifier is required.',
        'validate',
      );
    }
  }

  async validate(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<ValidationResult> {
    this.assertTenantContext(context);
    this.assertSupportedAction(request);
    return this.validateRequest(context, request);
  }

  protected abstract validateRequest(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<ValidationResult>;

  abstract buildDryRunPlan(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): DryRunPlan;

  abstract capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>>;

  abstract execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
  ): Promise<import('./types').AdapterStepResult>;

  abstract verify(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
    executionOutput: Record<string, unknown> | undefined,
  ): Promise<import('./types').VerificationResult>;

  abstract rollback(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
  ): Promise<import('./types').RollbackResult>;

  isRollbackEligible(
    _context: AdapterExecutionContext,
    _request: AdapterExecutionRequest,
  ): { eligible: boolean; reason?: string } {
    return { eligible: true };
  }
}
