import {
  AUDIT_EVENTS,
  buildAuditEvent,
  persistAuditEvent,
  writeAuditEventFromBuilt,
} from '../audit';
import { RepositoryConflictError } from '../database';
import type { ExecutionRunRepository } from '../repositories/contracts';
import type { ExecutionRunRecord } from '../repositories/models/execution-run-models';
import { generateExecutionId } from '../shared/utils';

import {
  rejectUnsupportedAction,
  type ExecutionAdapterRegistry,
} from './adapters/adapter-registry';
import {
  EXECUTION_MODES,
  ExecutionAdapterError,
  type AdapterExecutionContext,
  type AdapterExecutionRequest,
  type OrchestratedExecutionResult,
} from './adapters/types';

export interface ExecutionOrchestratorDeps {
  registry: ExecutionAdapterRegistry;
  runs: ExecutionRunRepository;
}

export class ExecutionOrchestrator {
  constructor(private readonly deps: ExecutionOrchestratorDeps) {}

  async run(
    context: AdapterExecutionContext,
    request: AdapterExecutionRequest,
  ): Promise<OrchestratedExecutionResult> {
    if (!context.mode) {
      throw new ExecutionAdapterError(
        'MODE_REQUIRED',
        'Execution mode is required.',
        'validate',
      );
    }

    const unsupported = rejectUnsupportedAction(
      request.service,
      request.action,
      this.deps.registry,
    );
    if (unsupported) {
      throw new ExecutionAdapterError(
        'UNSUPPORTED_ACTION',
        unsupported.reason,
        'resolve',
      );
    }

    const adapter = this.deps.registry.resolve(request.service);
    const runId = generateExecutionId();

    const validation = await adapter.validate(context, request);
    if (!validation.valid) {
      return {
        runId,
        mode: context.mode,
        status: 'VALIDATION_FAILED',
        validation,
        tenantId: context.tenantId,
        failure: validation.errors?.[0],
      };
    }

    if (context.mode === EXECUTION_MODES.VALIDATION) {
      return {
        runId,
        mode: context.mode,
        status: 'VALIDATED',
        validation,
        tenantId: context.tenantId,
      };
    }

    const dryRunPlan = adapter.buildDryRunPlan(context, request);
    if (context.mode === EXECUTION_MODES.DRY_RUN) {
      return {
        runId,
        mode: context.mode,
        status: 'PLANNED',
        validation,
        dryRunPlan,
        tenantId: context.tenantId,
      };
    }

    const rollbackEligibility = adapter.isRollbackEligible(context, request);
    let record = await this.deps.runs.create({
      tenantId: context.tenantId,
      runId,
      correlationId: context.correlationId,
      requestId: context.requestId,
      actorId: context.actorId,
      workflowId: context.workflowId,
      mode: context.mode,
      service: request.service,
      action: request.action.trim().toUpperCase(),
      resourceId: request.resourceId,
      region: context.region,
      status: 'RUNNING',
      rollbackState: {
        eligible: rollbackEligibility.eligible,
        reason: rollbackEligibility.reason,
      },
      validationResult: validation as unknown as Record<string, unknown>,
    });

    await this.emitExecutionAudit(
      context,
      runId,
      request,
      AUDIT_EVENTS.EXECUTION_STARTED,
      'started',
    );

    let previousConfiguration: Record<string, unknown> = {};
    try {
      previousConfiguration = await adapter.capturePreviousConfiguration(
        context,
        request,
      );
      record = await this.deps.runs.update(
        context.tenantId,
        runId,
        {
          previousConfiguration,
          executionSnapshot: {
            service: request.service,
            action: request.action.trim().toUpperCase(),
            resourceId: request.resourceId,
            region: context.region,
            parameters: request.parameters,
            capturedAt: new Date().toISOString(),
          },
          rollbackState: {
            eligible: rollbackEligibility.eligible,
            reason: rollbackEligibility.reason,
            previousConfiguration,
          },
        },
        { expectedVersion: record.version },
      );
    } catch (error) {
      return this.persistFailure(
        context,
        record,
        request,
        runId,
        {
          code: 'SNAPSHOT_FAILED',
          message:
            error instanceof Error ? error.message : 'Snapshot capture failed.',
          stage: 'capture',
        },
      );
    }

    const execution = await adapter.execute(
      context,
      request,
      previousConfiguration,
    );

    if (!execution.success) {
      return this.handleFailureWithRollback(
        context,
        record,
        request,
        runId,
        adapter,
        previousConfiguration,
        execution.error ?? {
          code: 'EXECUTION_FAILED',
          message: execution.message,
          stage: 'execute',
        },
        undefined,
      );
    }

    record = await this.deps.runs.update(
      context.tenantId,
      runId,
      {
        executionResult: execution as unknown as Record<string, unknown>,
      },
      { expectedVersion: record.version },
    );

    const verification = await adapter.verify(
      context,
      request,
      previousConfiguration,
      execution.output,
    );

    if (!verification.verified) {
      return this.handleFailureWithRollback(
        context,
        record,
        request,
        runId,
        adapter,
        previousConfiguration,
        verification.error ?? {
          code: 'VERIFICATION_FAILED',
          message: 'Verification failed.',
          stage: 'verify',
        },
        verification as unknown as Record<string, unknown>,
      );
    }

    record = await this.deps.runs.update(
      context.tenantId,
      runId,
      {
        status: 'SUCCEEDED',
        verificationResult: verification as unknown as Record<string, unknown>,
      },
      { expectedVersion: record.version },
    );

    await this.emitExecutionAudit(
      context,
      runId,
      request,
      AUDIT_EVENTS.EXECUTION_SUCCEEDED,
      'success',
    );

    return {
      runId,
      mode: context.mode,
      status: 'SUCCEEDED',
      validation,
      execution,
      verification,
      tenantId: context.tenantId,
    };
  }

  private async handleFailureWithRollback(
    context: AdapterExecutionContext,
    record: ExecutionRunRecord,
    request: AdapterExecutionRequest,
    runId: string,
    adapter: import('./adapters/types').ExecutionAdapter,
    previousConfiguration: Record<string, unknown>,
    failure: import('./adapters/types').StructuredExecutionError,
    verificationResult?: Record<string, unknown>,
  ): Promise<OrchestratedExecutionResult> {
    record = await this.deps.runs.update(
      context.tenantId,
      runId,
      {
        status: 'FAILED',
        failure,
        verificationResult,
        executionResult: record.executionResult,
      },
      { expectedVersion: record.version },
    );

    await this.emitExecutionAudit(
      context,
      runId,
      request,
      AUDIT_EVENTS.EXECUTION_FAILED,
      'failure',
      failure.code,
    );

    if (!record.rollbackState.eligible) {
      return {
        runId,
        mode: context.mode,
        status: 'FAILED',
        failure,
        tenantId: context.tenantId,
      };
    }

    await this.emitExecutionAudit(
      context,
      runId,
      request,
      AUDIT_EVENTS.ROLLBACK_STARTED,
      'started',
    );

    const rollback = await adapter.rollback(
      context,
      request,
      previousConfiguration,
    );

    if (rollback.success) {
      await this.deps.runs.update(
        context.tenantId,
        runId,
        {
          status: 'ROLLED_BACK',
          rollbackResult: rollback as unknown as Record<string, unknown>,
        },
        { expectedVersion: record.version + 1 },
      ).catch(async (error) => {
        if (error instanceof RepositoryConflictError) {
          const latest = await this.deps.runs.getById(context.tenantId, runId);
          if (latest) {
            await this.deps.runs.update(
              context.tenantId,
              runId,
              {
                status: 'ROLLED_BACK',
                rollbackResult: rollback as unknown as Record<string, unknown>,
              },
              { expectedVersion: latest.version },
            );
          }
        } else {
          throw error;
        }
      });

      await this.emitExecutionAudit(
        context,
        runId,
        request,
        AUDIT_EVENTS.ROLLBACK_COMPLETED,
        'success',
      );

      return {
        runId,
        mode: context.mode,
        status: 'ROLLED_BACK',
        failure,
        rollback,
        tenantId: context.tenantId,
      };
    }

    const rollbackFailure =
      rollback.error ?? {
        code: 'ROLLBACK_FAILED',
        message: rollback.message,
        stage: 'rollback',
      };

    await this.deps.runs.update(
      context.tenantId,
      runId,
      {
        status: 'ROLLBACK_FAILED',
        rollbackResult: rollback as unknown as Record<string, unknown>,
        rollbackFailure,
      },
      { expectedVersion: record.version + 1 },
    ).catch(() => undefined);

    await this.emitExecutionAudit(
      context,
      runId,
      request,
      AUDIT_EVENTS.ROLLBACK_FAILED,
      'failure',
      rollbackFailure.code,
    );

    return {
      runId,
      mode: context.mode,
      status: 'ROLLBACK_FAILED',
      failure,
      rollbackFailure,
      rollback,
      tenantId: context.tenantId,
    };
  }

  private async persistFailure(
    context: AdapterExecutionContext,
    record: ExecutionRunRecord,
    request: AdapterExecutionRequest,
    runId: string,
    failure: import('./adapters/types').StructuredExecutionError,
  ): Promise<OrchestratedExecutionResult> {
    await this.deps.runs.update(
      context.tenantId,
      runId,
      { status: 'FAILED', failure },
      { expectedVersion: record.version },
    );
    await this.emitExecutionAudit(
      context,
      runId,
      request,
      AUDIT_EVENTS.EXECUTION_FAILED,
      'failure',
      failure.code,
    );
    return {
      runId,
      mode: context.mode,
      status: 'FAILED',
      failure,
      tenantId: context.tenantId,
    };
  }

  private async emitExecutionAudit(
    context: AdapterExecutionContext,
    runId: string,
    request: AdapterExecutionRequest,
    eventName: (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS],
    outcome: 'started' | 'success' | 'failure',
    errorCode?: string,
  ): Promise<void> {
    const event = buildAuditEvent({
      eventName,
      outcome,
      requestId: context.requestId,
      correlationId: context.correlationId,
      actor: context.actor,
      tenantId: context.tenantId,
      executionId: runId,
      action: request.action.trim().toUpperCase(),
      resource: {
        type: request.service,
        id: request.resourceId,
        region: context.region,
      },
      errorCode,
    });

    writeAuditEventFromBuilt(event);
    await persistAuditEvent(event);
  }
}

export function createExecutionOrchestrator(
  deps: ExecutionOrchestratorDeps,
): ExecutionOrchestrator {
  return new ExecutionOrchestrator(deps);
}
