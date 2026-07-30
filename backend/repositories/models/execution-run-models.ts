import type {
  TenantRecordIdentity,
  VersionedRecord,
} from '../contracts/repository-types';

export type AdapterExecutionMode = 'VALIDATION' | 'DRY_RUN' | 'PRODUCTION';

export type AdapterExecutionStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'PLANNED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'ROLLBACK_PENDING'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED';

export type AwsExecutionService =
  | 'ec2'
  | 'autoscaling'
  | 'rds'
  | 's3'
  | 'cloudfront'
  | 'lambda';

export interface ExecutionSnapshot {
  service: AwsExecutionService;
  action: string;
  resourceId: string;
  region: string;
  parameters?: Record<string, unknown>;
  capturedAt: string;
}

export interface RollbackState {
  eligible: boolean;
  reason?: string;
  previousConfiguration?: Record<string, unknown>;
  executionSnapshot?: ExecutionSnapshot;
}

export interface StructuredExecutionError {
  code: string;
  message: string;
  stage?: string;
  awsErrorName?: string;
  retryable?: boolean;
}

export interface ExecutionRunRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  runId: string;
  correlationId: string;
  requestId: string;
  actorId: string;
  workflowId?: string;
  mode: AdapterExecutionMode;
  service: AwsExecutionService;
  action: string;
  resourceId: string;
  region: string;
  status: AdapterExecutionStatus;
  rollbackState: RollbackState;
  previousConfiguration?: Record<string, unknown>;
  executionSnapshot?: ExecutionSnapshot;
  validationResult?: Record<string, unknown>;
  executionResult?: Record<string, unknown>;
  verificationResult?: Record<string, unknown>;
  rollbackResult?: Record<string, unknown>;
  dryRunPlan?: Record<string, unknown>;
  failure?: StructuredExecutionError;
  rollbackFailure?: StructuredExecutionError;
}
