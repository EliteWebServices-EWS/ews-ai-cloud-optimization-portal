/**
 * Predefined public demo scenarios — aligned with backend mock provider candidates
 * (MOCK_INSTANCES / MOCK_RECOMMENDATIONS) plus one illustrative multi-instance snapshot.
 */

export interface Ec2DemoScenarioDefinition {
  id: string;
  label: string;
  description: string;
  /** Mock workflow candidate resource id when scenario is candidate-scoped. */
  mockCandidateId?: string;
}

/** Default selection on first visit. */
export const DEFAULT_DEMO_SCENARIO_ID = 'i-mock-001';

export const EC2_DEMO_SCENARIOS: Ec2DemoScenarioDefinition[] = [
  {
    id: 'i-mock-001',
    label: 'web-server-01 · i-mock-001',
    description:
      'Mock provider candidate t3.large (production) — underutilized; resize to t3.medium per mock recommendation.',
    mockCandidateId: 'i-mock-001',
  },
  {
    id: 'i-mock-002',
    label: 'dev-api-01 · i-mock-002',
    description:
      'Mock provider candidate m5.xlarge (development) — overprovisioned; resize to m5.large per mock recommendation.',
    mockCandidateId: 'i-mock-002',
  },
  {
    id: 'i-mock-003',
    label: 'staging-worker · i-mock-003',
    description:
      'Mock provider candidate t3.medium (staging) — moderate utilization; no mock resize recommendation on file.',
    mockCandidateId: 'i-mock-003',
  },
  {
    id: 'i-mock-004',
    label: 'analytics-batch · i-mock-004',
    description:
      'Mock provider candidate c5.2xlarge (production) — underutilized; resize to c5.xlarge per mock recommendation.',
    mockCandidateId: 'i-mock-004',
  },
  {
    id: 'illustrative-fleet',
    label: 'Illustrative multi-instance fleet',
    description:
      'Curated synthetic fleet snapshot (i-demo-ec2-* identifiers) — not tied to a single mock workflow candidate.',
  },
];

export function getDemoScenarioById(scenarioId: string): Ec2DemoScenarioDefinition | undefined {
  return EC2_DEMO_SCENARIOS.find((scenario) => scenario.id === scenarioId);
}

export function listDemoScenarioIds(): string[] {
  return EC2_DEMO_SCENARIOS.map((scenario) => scenario.id);
}
