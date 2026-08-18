import { EVIDENCE_MATURITY_MODEL_VERSION } from '../evidence-maturity/model-version';
import type {
  ConfidenceLongitudinalEvidence,
  ConfidenceMaturityEvidence,
  ConfidencePersistenceEvidence,
} from '../shared/types';
import type { EvidenceMaturityRepository } from '../repositories/contracts/evidence-maturity-repository';
import type { EvidenceObservationRepository } from '../repositories/contracts/evidence-observation-repository';
import type { EvidenceMaturityAssessmentRecord } from '../evidence-maturity/types';
import type { EvidenceObservationRecord } from '../persistence-intelligence/types';

export interface ComposeConfidenceLongitudinalEvidenceInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  sourceObservationId?: string;
  governanceContextAvailable?: boolean;
}

function mapPersistenceEvidence(
  observation: EvidenceObservationRecord,
): ConfidencePersistenceEvidence {
  return {
    state: observation.assessment.state,
    persistenceHours: observation.assessment.persistenceHours,
    reasonCodes: observation.assessment.reasonCodes,
    logicalObservationId: observation.assessment.logicalObservationId,
    comparedToObservationId: observation.assessment.comparedToObservationId,
    sourceObservationId: observation.observationId,
    ruleId: observation.ruleId,
    ruleVersion: observation.ruleVersion,
  };
}

function mapMaturityEvidence(record: EvidenceMaturityAssessmentRecord): ConfidenceMaturityEvidence {
  return {
    maturity: record.maturity,
    modelVersion: record.modelVersion,
    reasonCodes: record.reasonCodes,
    sourcePersistenceState: record.sourcePersistenceState,
    stableEpochObservationCount: record.stableEpochObservationCount,
    stableEpochHours: record.stableEpochHours,
    persistenceHours: record.persistenceHours,
    evidenceCompleteness: record.evidenceCompleteness,
    telemetryApplicability: record.telemetryApplicability,
    sourceObservationId: record.sourceObservationId,
    sourceLogicalObservationId: record.sourceLogicalObservationId,
    ruleId: record.ruleId,
    ruleVersion: record.ruleVersion,
  };
}

/**
 * Composes already-persisted authoritative persistence and maturity slices for confidence.
 * Requires an explicit findingKey — resourceId alone is not a safe correlation key.
 */
export class ConfidenceEvidenceService {
  constructor(
    private readonly observations: EvidenceObservationRepository,
    private readonly maturityRepository: EvidenceMaturityRepository,
  ) {}

  async compose(
    input: ComposeConfidenceLongitudinalEvidenceInput,
  ): Promise<ConfidenceLongitudinalEvidence | undefined> {
    const observation = await this.resolveObservation(input);
    if (!observation) {
      return undefined;
    }

    const maturityRecord = await this.maturityRepository.getAssessmentByLogicalKey({
      tenantId: input.tenantId,
      accountId: input.accountId,
      findingKey: input.findingKey,
      sourceLogicalObservationId: observation.logicalObservationId,
      modelVersion: EVIDENCE_MATURITY_MODEL_VERSION,
      sourceObservationTimestamp: observation.observationTimestamp,
    });

    const result: ConfidenceLongitudinalEvidence = {
      persistence: mapPersistenceEvidence(observation),
      governanceConvergence: {
        contextAvailable: input.governanceContextAvailable ?? false,
      },
    };

    if (maturityRecord) {
      if (maturityRecord.sourceObservationId === observation.observationId) {
        result.maturity = mapMaturityEvidence(maturityRecord);
      }
    }

    return result;
  }

  private async resolveObservation(
    input: ComposeConfidenceLongitudinalEvidenceInput,
  ): Promise<EvidenceObservationRecord | null> {
    const observations: EvidenceObservationRecord[] = [];
    let nextToken: string | undefined;

    do {
      const page = await this.observations.listObservationsForFinding({
        tenantId: input.tenantId,
        accountId: input.accountId,
        findingKey: input.findingKey,
        limit: 100,
        nextToken,
      });
      observations.push(...page.items);
      nextToken = page.nextToken;
    } while (nextToken);

    if (observations.length === 0) {
      return null;
    }

    if (input.sourceObservationId) {
      return observations.find((item) => item.observationId === input.sourceObservationId) ?? null;
    }

    return observations[observations.length - 1] ?? null;
  }
}
