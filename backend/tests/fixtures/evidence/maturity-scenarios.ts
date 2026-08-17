import type { EvidenceObservationRecord } from '../../../persistence-intelligence/types';
import type { EvidenceObservationRepository } from '../../../repositories/contracts/evidence-observation-repository';
import {
  buildChangedRecommendationScenario,
  buildManyHistoricalObservations,
  buildPersistentRecommendationScenario,
  replayPersistenceScenario,
} from './persistence-scenarios';

export async function recordObservationHistory(
  repo: EvidenceObservationRepository,
  inputs: Parameters<EvidenceObservationRepository['recordObservation']>[0][],
): Promise<EvidenceObservationRecord[]> {
  const records: EvidenceObservationRecord[] = [];
  for (const input of inputs) {
    const result = await repo.recordObservation(input);
    records.push(result.observation);
  }
  return records;
}

export async function buildPersistentObservationHistory(
  repo: EvidenceObservationRepository,
): Promise<EvidenceObservationRecord[]> {
  await replayPersistenceScenario(repo, buildPersistentRecommendationScenario());
  const scenario = buildPersistentRecommendationScenario();
  const lastInput = scenario.inputs[scenario.inputs.length - 1]!;
  const page = await repo.listObservationsForFinding({
    tenantId: lastInput.tenantId,
    accountId: lastInput.accountId,
    findingKey: lastInput.findingKey,
    limit: 100,
  });
  return page.items;
}

export { buildManyHistoricalObservations, buildChangedRecommendationScenario, buildPersistentRecommendationScenario };
