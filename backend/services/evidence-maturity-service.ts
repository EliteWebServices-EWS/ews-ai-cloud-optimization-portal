import type { Ec2PerformanceEvidence } from '../cloud-intelligence/ec2-cost/ec2-cost-models';
import {
  DEFAULT_EVIDENCE_MATURITY_CONFIG,
  evaluateEvidenceMaturity,
  resolveDataCompleteness,
  resolveTelemetryApplicability,
} from '../evidence-maturity';
import type { EvidenceMaturityAssessment, RecordEvidenceMaturityAssessmentResult } from '../evidence-maturity/types';
import type { ActionLogEmitter } from '../action-log/action-log-emitter';
import type { ActionLogLifecycleContext } from '../action-log/lifecycle-context';
import type { EvidenceObservationRecord } from '../persistence-intelligence/types';
import type { EvidenceMaturityRepository } from '../repositories/contracts/evidence-maturity-repository';
import type { EvidenceObservationRepository } from '../repositories/contracts/evidence-observation-repository';

export interface EvaluateAndPersistEvidenceMaturityInput {
  observation: EvidenceObservationRecord;
  currentPerformanceEvidence?: Ec2PerformanceEvidence;
  evaluatedAt: string;
}

const HISTORY_PAGE_SIZE = 100;

export class EvidenceMaturityService {
  constructor(
    private readonly maturityRepository: EvidenceMaturityRepository,
    private readonly observationRepository: EvidenceObservationRepository,
    private readonly actionLogEmitter?: ActionLogEmitter,
  ) {}

  async listAllObservationsForFinding(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
  }): Promise<EvidenceObservationRecord[]> {
    const observations: EvidenceObservationRecord[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.observationRepository.listObservationsForFinding({
        tenantId: input.tenantId,
        accountId: input.accountId,
        findingKey: input.findingKey,
        limit: HISTORY_PAGE_SIZE,
        nextToken,
      });
      observations.push(...page.items);
      nextToken = page.nextToken;
    } while (nextToken);
    return observations;
  }

  buildAssessment(input: EvaluateAndPersistEvidenceMaturityInput): EvidenceMaturityAssessment {
    const observation = input.observation;
    const telemetryApplicability = resolveTelemetryApplicability({
      ruleId: observation.ruleId,
      category: observation.category,
    });
    const dataCompleteness = resolveDataCompleteness({
      telemetryApplicability,
      dataCompleteness: input.currentPerformanceEvidence?.dataCompleteness,
    });

    return evaluateEvidenceMaturity({
      sourceObservation: observation,
      findingHistory: [observation],
      telemetryApplicability,
      dataCompleteness,
      evaluatedAt: input.evaluatedAt,
      config: DEFAULT_EVIDENCE_MATURITY_CONFIG,
    });
  }

  async evaluateAndPersist(
    input: EvaluateAndPersistEvidenceMaturityInput & {
      actionLogContext?: ActionLogLifecycleContext;
    },
  ): Promise<RecordEvidenceMaturityAssessmentResult> {
    const observation = input.observation;
    const findingHistory = await this.listAllObservationsForFinding({
      tenantId: observation.tenantId,
      accountId: observation.accountId,
      findingKey: observation.findingKey,
    });

    const telemetryApplicability = resolveTelemetryApplicability({
      ruleId: observation.ruleId,
      category: observation.category,
    });
    const dataCompleteness = resolveDataCompleteness({
      telemetryApplicability,
      dataCompleteness: input.currentPerformanceEvidence?.dataCompleteness,
    });

    const assessment = evaluateEvidenceMaturity({
      sourceObservation: observation,
      findingHistory,
      telemetryApplicability,
      dataCompleteness,
      evaluatedAt: input.evaluatedAt,
      config: DEFAULT_EVIDENCE_MATURITY_CONFIG,
    });

    const persisted = await this.maturityRepository.recordAssessment(assessment);
    if (this.actionLogEmitter && input.actionLogContext) {
      await this.actionLogEmitter.emitAfterMaturityAssessment({
        assessment: persisted.record,
        context: input.actionLogContext,
      });
    }
    return persisted;
  }
}
