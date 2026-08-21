import type { ActionLogService } from '../services/action-log-service';
import type { ActionLogRecord } from '../action-log/types';
import type { PageResult } from '../repositories/contracts/repository-types';
import { evaluateProvenanceCompleteness } from '../provenance-reconstruction/completeness';
import { extractMlProvenance } from '../provenance-reconstruction/ml-provenance';
import { ProvenanceReconstructionError, ProvenanceScopeError } from '../provenance-reconstruction/errors';
import { dedupeAndOrderActionLogRecords } from '../provenance-reconstruction/ordering';
import { PROVENANCE_REASON } from '../provenance-reconstruction/reason-codes';
import {
  collectPolicyVersions,
  resolveSourceReferences,
  type ProvenanceSourceResolverDeps,
} from '../provenance-reconstruction/source-reference';
import type {
  DecisionProvenanceReconstructionResult,
  ReconstructDecisionProvenanceInput,
  SourceVerificationMode,
} from '../provenance-reconstruction/types';

async function loadAllActionLogEvents(
  loader: (nextToken?: string) => Promise<PageResult<ActionLogRecord>>,
): Promise<ActionLogRecord[]> {
  const events: ActionLogRecord[] = [];
  let nextToken: string | undefined;

  do {
    const page = await loader(nextToken);
    events.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);

  return events;
}

function assertTrustedScope(
  events: readonly ActionLogRecord[],
  input: ReconstructDecisionProvenanceInput,
): void {
  for (const event of events) {
    if (event.tenantId !== input.tenantId) {
      throw new ProvenanceScopeError(
        `${PROVENANCE_REASON.PROVENANCE_TENANT_SCOPE_VIOLATION}: event ${event.logicalEventId}`,
      );
    }
    if (event.accountId && event.accountId !== input.accountId) {
      throw new ProvenanceScopeError(
        `${PROVENANCE_REASON.PROVENANCE_ACCOUNT_SCOPE_VIOLATION}: event ${event.logicalEventId}`,
      );
    }
  }
}

function resolveDecisionId(
  input: ReconstructDecisionProvenanceInput,
  events: readonly ActionLogRecord[],
): string | null {
  if (input.decisionId) {
    return input.decisionId;
  }
  const fromEvents = events.find((event) => event.decisionId)?.decisionId;
  return fromEvents ?? null;
}

function resolveCorrelationId(
  input: ReconstructDecisionProvenanceInput,
  events: readonly ActionLogRecord[],
): string {
  if (input.correlationId) {
    return input.correlationId;
  }
  const fromEvents = events.find((event) => event.correlationId)?.correlationId;
  if (!fromEvents) {
    throw new ProvenanceReconstructionError(
      'Unable to resolve correlationId from ActionLog lifecycle.',
    );
  }
  return fromEvents;
}

export class DecisionProvenanceReconstructionService {
  constructor(
    private readonly actionLogService: ActionLogService,
    private readonly sourceResolverDeps: ProvenanceSourceResolverDeps = {},
  ) {}

  async reconstruct(
    input: ReconstructDecisionProvenanceInput,
  ): Promise<DecisionProvenanceReconstructionResult> {
    if (!input.decisionId && !input.correlationId) {
      throw new ProvenanceReconstructionError(
        'Either decisionId or correlationId is required.',
      );
    }

    const rawEvents = input.decisionId
      ? await loadAllActionLogEvents((nextToken) =>
          this.actionLogService.reconstructDecisionLifecycle(
            input.tenantId,
            input.decisionId!,
            { nextToken },
          ),
        )
      : await loadAllActionLogEvents((nextToken) =>
          this.actionLogService.reconstructCorrelationLifecycle(
            input.tenantId,
            input.correlationId!,
            { nextToken },
          ),
        );

    assertTrustedScope(rawEvents, input);

    const orderedEvents = dedupeAndOrderActionLogRecords(rawEvents);

    const sourceVerificationMode: SourceVerificationMode =
      input.sourceVerificationMode ?? 'source_verified';

    if (orderedEvents.length === 0) {
      return {
        tenantId: input.tenantId,
        accountId: input.accountId,
        decisionId: input.decisionId ?? null,
        correlationId: input.correlationId ?? input.decisionId ?? '',
        completeness: 'INCOMPLETE',
        reasonCodes: [PROVENANCE_REASON.PROVENANCE_LIFECYCLE_NOT_FOUND],
        orderedEvents: [],
        sourceReferences: [],
        stagesPresent: [],
        stagesMissing: ['LIFECYCLE'],
        policyVersions: {},
        mlProvenance: null,
        sourceVerificationMode,
        reconstructedAt: new Date().toISOString(),
      };
    }

    const correlationId = resolveCorrelationId(input, orderedEvents);
    const decisionId = resolveDecisionId(input, orderedEvents);

    if (
      input.decisionId &&
      decisionId &&
      orderedEvents.some(
        (event) => event.decisionId && event.decisionId !== input.decisionId,
      )
    ) {
      throw new ProvenanceScopeError(
        PROVENANCE_REASON.PROVENANCE_DECISION_SCOPE_MISMATCH,
      );
    }

    const sourceReferences = await resolveSourceReferences(
      orderedEvents,
      { tenantId: input.tenantId, accountId: input.accountId },
      this.sourceResolverDeps,
    );

    const evaluation = evaluateProvenanceCompleteness(
      orderedEvents,
      sourceReferences,
      { sourceVerificationMode },
    );

    return {
      tenantId: input.tenantId,
      accountId: input.accountId,
      decisionId,
      correlationId,
      completeness: evaluation.completeness,
      reasonCodes: evaluation.reasonCodes,
      orderedEvents,
      sourceReferences,
      stagesPresent: evaluation.stagesPresent,
      stagesMissing: evaluation.stagesMissing,
      policyVersions: collectPolicyVersions(orderedEvents),
      mlProvenance: extractMlProvenance(orderedEvents),
      sourceVerificationMode,
      reconstructedAt: new Date().toISOString(),
    };
  }
}
