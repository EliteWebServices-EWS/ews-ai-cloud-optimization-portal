import { describe, it, expect } from 'vitest';
import { buildDemoScenarioViewModel } from './ec2-demo-scenario-view-models';
import { attachDemoDecisionIntelligence } from './ec2-demo-decision-builders';
import { DEMO_DECISION_WORKFLOW_STAGES } from './ec2-demo-decision-types';
import { buildEc2JsonReport } from '../ec2/render-ec2-dashboard';
import { renderEvidenceStatus } from '../components/EvidenceStatus';
import { renderGovernancePanel } from '../components/GovernancePanel';
import { renderDemoVerificationPanel } from './demo-decision-renderer';

const MOCK_CANDIDATES_WITH_REC = ['i-mock-001', 'i-mock-002', 'i-mock-004'] as const;

describe('ec2-demo-decision-builders', () => {
  it('includes eight completed workflow stages for mock-001', () => {
    const vm = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-001'));
    expect(vm.demoDecisionIntelligence?.completedStages).toEqual([...DEMO_DECISION_WORKFLOW_STAGES]);
    expect(vm.demoDecisionIntelligence?.completedStages).toHaveLength(8);
  });

  it('marks execution as SIMULATED and verification as NOT_EXECUTED', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-002'))
      .demoDecisionIntelligence!;
    expect(snapshot.execution.status).toBe('SIMULATED');
    expect(snapshot.verification.status).toBe('NOT_EXECUTED');
    expect(snapshot.verification.message).toMatch(/no AWS resource/i);
  });

  it('i-mock-001 NOT_EXECUTED verification UI does not show measured zero outcomes', () => {
    const vm = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-001'));
    const snapshot = vm.demoDecisionIntelligence!;
    expect(snapshot.verification.expectedSavings).toBe(30.37);
    expect(snapshot.verification.verifiedSavings).toBe(0);

    const el = document.createElement('div');
    renderDemoVerificationPanel(el, snapshot);
    expect(el.textContent).toContain('NOT_EXECUTED');
    expect(el.textContent).toContain('30.37');
    expect(el.textContent).toContain('Not available — execution not performed');
    expect(el.textContent).toContain('Not applicable');
    expect(el.textContent).toContain('Not evaluated');
    expect(el.textContent).not.toMatch(/Verified Savings[\s\S]*\$0\.00/);
  });

  it('i-mock-001 decision basis is built from scenario model without hardcoded-only values', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-001'))
      .demoDecisionIntelligence!;
    const basis = snapshot.reportPreview.decisionBasis;
    expect(basis.evidence).toMatch(/COMPLETE/i);
    expect(basis.governance).toContain('NEEDS APPROVAL');
    expect(basis.confidence).toContain('HIGH');
    expect(basis.confidence).toMatch(/numeric score unavailable/i);
    expect(basis.execution).toBe('SIMULATED');
    expect(basis.verification).toBe('NOT_EXECUTED');
  });

  it('i-mock-003 decision basis shows confidence unavailable and NOT_EXECUTED verification', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-003'))
      .demoDecisionIntelligence!;
    expect(snapshot.reportPreview.decisionBasis.confidence).toBe('Not available for this demo scenario');
    expect(snapshot.reportPreview.decisionBasis.verification).toBe('NOT_EXECUTED');
  });

  it('has no recommendation confidence for i-mock-003', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-003'))
      .demoDecisionIntelligence!;
    expect(snapshot.confidenceUnavailable).toBe(true);
    expect(snapshot.recommendation).toBeUndefined();
  });

  it('learning outcome does not claim production persistence', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('illustrative-fleet'))
      .demoDecisionIntelligence!;
    expect(snapshot.learningOutcome).toMatch(/not persisted/i);
  });

  it.each(MOCK_CANDIDATES_WITH_REC)(
    'uses fixture confidenceLevel only (no invented %) for %s',
    (scenarioId) => {
      const vm = buildDemoScenarioViewModel(scenarioId);
      const fixtureLevel = vm.cost.recommendations[0]?.confidenceLevel?.toUpperCase();
      const snapshot = attachDemoDecisionIntelligence(vm).demoDecisionIntelligence!;
      expect(fixtureLevel).toBeTruthy();
      expect(snapshot.confidence?.status).toBe(fixtureLevel);
      expect(snapshot.confidence?.score).toBeUndefined();
      expect(snapshot.reportPreview.confidenceSummary).not.toMatch(/\d+%/);
      expect(snapshot.reportPreview.confidenceSummary).toContain(fixtureLevel!);
    },
  );

  it('illustrative-fleet confidence is HIGH from fixture without numeric score', () => {
    const vm = buildDemoScenarioViewModel('illustrative-fleet');
    expect(vm.cost.recommendations[0]?.confidenceLevel).toBe('HIGH');
    const snapshot = attachDemoDecisionIntelligence(vm).demoDecisionIntelligence!;
    expect(snapshot.confidence?.status).toBe('HIGH');
    expect(snapshot.confidence?.score).toBeUndefined();
    expect(snapshot.reportPreview.confidenceSummary).not.toMatch(/\d+%/);
  });

  it('does not invent governance readiness scores for mock candidates', () => {
    for (const id of ['i-mock-001', 'i-mock-002', 'i-mock-003', 'i-mock-004', 'illustrative-fleet']) {
      const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel(id))
        .demoDecisionIntelligence!;
      expect(snapshot.governance?.readinessScore).toBeUndefined();
      expect(snapshot.governance?.readiness?.score).toBeUndefined();
    }
  });

  it('evidence monthly rate is unavailable in fixture, not placeholder $0', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-001'))
      .demoDecisionIntelligence!;
    expect(snapshot.evidence?.pricing).toBeUndefined();
    const el = document.createElement('div');
    renderEvidenceStatus(el, snapshot.evidence);
    expect(el.textContent).toContain('Unavailable in demo fixture');
    expect(el.textContent).not.toContain('$0.00');
  });

  it('JSON export omits fabricated confidenceScore and governance readiness', () => {
    const vm = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-001'));
    const json = buildEc2JsonReport(vm);
    const parsed = JSON.parse(json) as {
      decisionIntelligence: {
        confidenceLevel: string;
        confidenceScore: null;
        confidenceSummary: string;
        governanceReadinessScore: null;
        verification: {
          status: string;
          expectedSavings: number;
          verifiedSavings: null;
          variance: null;
          stateMatched: null;
        };
      };
    };
    expect(parsed.decisionIntelligence.confidenceLevel).toBe('HIGH');
    expect(parsed.decisionIntelligence.confidenceScore).toBeNull();
    expect(parsed.decisionIntelligence.confidenceSummary).not.toMatch(/\d+%/);
    expect(parsed.decisionIntelligence.governanceReadinessScore).toBeNull();
    expect(parsed.decisionIntelligence.verification.status).toBe('NOT_EXECUTED');
    expect(parsed.decisionIntelligence.verification.expectedSavings).toBe(30.37);
    expect(parsed.decisionIntelligence.verification.verifiedSavings).toBeNull();
    expect(parsed.decisionIntelligence.verification.variance).toBeNull();
    expect(parsed.decisionIntelligence.verification.stateMatched).toBeNull();
  });

  it('governance panel shows illustrative wording instead of invented readiness %', () => {
    const snapshot = attachDemoDecisionIntelligence(buildDemoScenarioViewModel('i-mock-001'))
      .demoDecisionIntelligence!;
    const el = document.createElement('div');
    renderGovernancePanel(el, snapshot.governance);
    expect(el.textContent).toMatch(/no readiness score in demo fixture/i);
    expect(el.textContent).not.toMatch(/82% readiness/);
  });

  it.each(['i-mock-001', 'i-mock-002', 'i-mock-003', 'i-mock-004', 'illustrative-fleet'] as const)(
    'does not attach invented networkUtilization to decision evidence for %s',
    (scenarioId) => {
      const vm = attachDemoDecisionIntelligence(buildDemoScenarioViewModel(scenarioId));
      const snapshot = vm.demoDecisionIntelligence!;
      expect(snapshot.evidence?.telemetry?.networkUtilization).toBeUndefined();
      const json = buildEc2JsonReport(vm);
      expect(json).not.toMatch(/"networkUtilization"\s*:\s*[0-9]/);
    },
  );

  it('illustrative-fleet evidence omits memory utilization not present in curated fixture', () => {
    const vm = buildDemoScenarioViewModel('illustrative-fleet');
    expect(vm.averageCpuUtilization).toBe(52.4);
    expect('averageMemoryUtilization' in vm).toBe(false);

    const snapshot = attachDemoDecisionIntelligence(vm).demoDecisionIntelligence!;
    expect(snapshot.evidence?.telemetry?.cpuUtilization).toBe(52.4);
    expect(snapshot.evidence?.telemetry?.memoryUtilization).toBeUndefined();

    const el = document.createElement('div');
    renderEvidenceStatus(el, snapshot.evidence);
    expect(el.textContent).not.toContain('40%');
    expect(el.textContent).toMatch(/Memory Utilization[\s\S]*Unavailable in demo fixture/i);

    const json = buildEc2JsonReport(attachDemoDecisionIntelligence(vm));
    expect(json).not.toContain('"memoryUtilization":40');
    expect(json).not.toContain('"memoryUtilization": 40');
  });
});
