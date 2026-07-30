import type { AuditActor } from '../../audit';
import type {
  AdapterExecutionMode,
  AwsExecutionService,
  StructuredExecutionError,
} from '../../repositories/models/execution-run-models';

export type { AdapterExecutionMode, AwsExecutionService, StructuredExecutionError };

export const EXECUTION_MODES = {
  VALIDATION: 'VALIDATION',
  DRY_RUN: 'DRY_RUN',
  PRODUCTION: 'PRODUCTION',
} as const satisfies Record<AdapterExecutionMode, AdapterExecutionMode>;

export interface AdapterExecutionContext {
  tenantId: string;
  actorId: string;
  actor: AuditActor;
  correlationId: string;
  requestId: string;
  workflowId?: string;
  region: string;
  mode: AdapterExecutionMode;
}

export interface AdapterExecutionRequest {
  service: AwsExecutionService;
  action: string;
  resourceId: string;
  parameters?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  checks: string[];
  errors?: StructuredExecutionError[];
}

export interface DryRunPlan {
  service: AwsExecutionService;
  action: string;
  resourceId: string;
  region: string;
  steps: string[];
  parameters?: Record<string, unknown>;
  reversible: boolean;
  rollbackNotes?: string;
}

export interface AdapterStepResult {
  success: boolean;
  message: string;
  output?: Record<string, unknown>;
  error?: StructuredExecutionError;
}

export interface VerificationResult {
  verified: boolean;
  checks: string[];
  error?: StructuredExecutionError;
}

export interface RollbackResult {
  success: boolean;
  message: string;
  restoredConfiguration?: Record<string, unknown>;
  error?: StructuredExecutionError;
  nonReversible?: boolean;
  reason?: string;
}

export interface UnsupportedOperationResult {
  supported: false;
  service: AwsExecutionService;
  action: string;
  reason: string;
}

export interface OrchestratedExecutionResult {
  runId: string;
  mode: AdapterExecutionMode;
  status: string;
  validation?: ValidationResult;
  dryRunPlan?: DryRunPlan;
  execution?: AdapterStepResult;
  verification?: VerificationResult;
  rollback?: RollbackResult;
  failure?: StructuredExecutionError;
  rollbackFailure?: StructuredExecutionError;
  tenantId: string;
}

export interface ExecutionAdapter {
  readonly service: AwsExecutionService;
  supportedActions(): readonly string[];
  validate(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<ValidationResult>;
  buildDryRunPlan(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): DryRunPlan;
  capturePreviousConfiguration(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<Record<string, unknown>>;
  execute(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
  ): Promise<AdapterStepResult>;
  verify(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
    executionOutput: Record<string, unknown> | undefined,
  ): Promise<VerificationResult>;
  rollback(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
    previousConfiguration: Record<string, unknown>,
  ): Promise<RollbackResult>;
  isRollbackEligible(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): { eligible: boolean; reason?: string };
}

export class ExecutionAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly stage?: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'ExecutionAdapterError';
  }

  toStructuredError(): StructuredExecutionError {
    return {
      code: this.code,
      message: this.message,
      stage: this.stage,
    };
  }
}

export function unsupportedOperation(
  service: AwsExecutionService,
  action: string,
  reason: string,
): UnsupportedOperationResult {
  return { supported: false, service, action, reason };
}
