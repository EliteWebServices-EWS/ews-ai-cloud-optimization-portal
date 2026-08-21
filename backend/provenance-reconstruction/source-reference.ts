import type { ActionLogRecord } from '../action-log/types';
import type { ExecutionPlanRepository } from '../repositories/contracts/execution-plan-repository';
import type { ExecutionRunRepository } from '../repositories/contracts/execution-run-repository';
import type { LearningRepository } from '../repositories/contracts/learning-repository';
import type { VerificationRepository as EngineVerificationRepository } from '../engines/verification/verification.repository';
import type { ProvenanceSourceAvailability, ProvenanceSourceReference } from './types';
import { getStageProvenanceClass } from './stage-provenance';

export interface ProvenanceSourceResolverContext {
  tenantId: string;
  accountId: string;
}

export interface ProvenanceSourceResolverDeps {
  executionPlanRepository?: ExecutionPlanRepository;
  executionRunRepository?: ExecutionRunRepository;
  verificationRepository?: EngineVerificationRepository;
  learningRepository?: LearningRepository;
}

function toSourceReference(
  event: ActionLogRecord,
  availability: ProvenanceSourceAvailability,
): ProvenanceSourceReference {
  return {
    sourceStage: event.sourceStage,
    eventType: event.eventType,
    sourceRecordId: event.sourceRecordId,
    sourceRecordVersion: event.sourceRecordVersion,
    tenantId: event.tenantId,
    accountId: event.accountId,
    occurredAt: event.occurredAt,
    logicalEventId: event.logicalEventId,
    availability,
    modelId: event.modelId,
  };
}

async function resolveExecutionAvailability(
  deps: ProvenanceSourceResolverDeps,
  context: ProvenanceSourceResolverContext,
  event: ActionLogRecord,
): Promise<ProvenanceSourceAvailability> {
  const hasResolver = Boolean(
    deps.executionPlanRepository || deps.executionRunRepository,
  );
  if (!hasResolver) {
    return 'NOT_RESOLVED';
  }

  if (deps.executionPlanRepository) {
    const plan = await deps.executionPlanRepository.getById(
      context.tenantId,
      event.sourceRecordId,
    );
    if (plan && plan.tenantId === context.tenantId) {
      return 'AVAILABLE';
    }
  }

  if (deps.executionRunRepository) {
    const run = await deps.executionRunRepository.getById(
      context.tenantId,
      event.sourceRecordId,
    );
    if (run && run.tenantId === context.tenantId) {
      return 'AVAILABLE';
    }
  }

  return 'UNAVAILABLE';
}

async function resolveVerificationAvailability(
  deps: ProvenanceSourceResolverDeps,
  context: ProvenanceSourceResolverContext,
  event: ActionLogRecord,
): Promise<ProvenanceSourceAvailability> {
  if (!deps.verificationRepository) {
    return 'NOT_RESOLVED';
  }

  const executionId = event.executionId ?? event.sourceRecordId;
  const record = await deps.verificationRepository.findByExecutionId(
    context.tenantId,
    executionId,
  );
  if (!record) {
    return 'UNAVAILABLE';
  }
  if (record.accountId && record.accountId !== context.accountId) {
    return 'UNAVAILABLE';
  }
  return 'AVAILABLE';
}

async function resolveLearningAvailability(
  deps: ProvenanceSourceResolverDeps,
  context: ProvenanceSourceResolverContext,
  event: ActionLogRecord,
): Promise<ProvenanceSourceAvailability> {
  if (!deps.learningRepository) {
    return 'NOT_RESOLVED';
  }

  const record = await deps.learningRepository.get(
    context.tenantId,
    event.sourceRecordId,
  );
  if (!record) {
    return 'UNAVAILABLE';
  }
  return 'AVAILABLE';
}

function resolveReferenceAvailability(
  event: ActionLogRecord,
  resolved: ProvenanceSourceAvailability,
): ProvenanceSourceAvailability {
  if (getStageProvenanceClass(event.sourceStage) === 'ACTIONLOG_AUTHORITATIVE') {
    return 'ACTIONLOG_AUTHORITATIVE';
  }
  return resolved;
}

export async function resolveSourceReferences(
  events: readonly ActionLogRecord[],
  context: ProvenanceSourceResolverContext,
  deps: ProvenanceSourceResolverDeps = {},
): Promise<ProvenanceSourceReference[]> {
  const references: ProvenanceSourceReference[] = [];

  for (const event of events) {
    let availability: ProvenanceSourceAvailability = 'NOT_RESOLVED';

    switch (event.sourceStage) {
      case 'EXECUTION':
        availability = resolveReferenceAvailability(
          event,
          await resolveExecutionAvailability(deps, context, event),
        );
        break;
      case 'VERIFICATION':
        availability = resolveReferenceAvailability(
          event,
          await resolveVerificationAvailability(deps, context, event),
        );
        break;
      case 'APPROVAL':
        availability = resolveReferenceAvailability(
          event,
          await resolveExecutionAvailability(deps, context, event),
        );
        break;
      case 'ML':
        availability = 'ACTIONLOG_AUTHORITATIVE';
        break;
      default:
        availability = 'NOT_RESOLVED';
        break;
    }

    if (
      event.eventType === 'RECOMMENDATION_DECIDED' &&
      deps.learningRepository
    ) {
      availability = await resolveLearningAvailability(deps, context, event);
    }

    references.push(toSourceReference(event, availability));
  }

  return references;
}

export function collectPolicyVersions(
  events: readonly ActionLogRecord[],
): Record<string, string | undefined> {
  const versions: Record<string, string | undefined> = {};

  for (const event of events) {
    if (event.sourceRecordVersion) {
      versions[event.sourceStage] = event.sourceRecordVersion;
    }
  }

  return versions;
}
