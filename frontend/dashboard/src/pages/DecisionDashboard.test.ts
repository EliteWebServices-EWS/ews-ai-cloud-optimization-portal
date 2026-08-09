import { describe, it, expect, vi } from 'vitest';
import { DecisionDashboard } from './DecisionDashboard';
import type { Ec2AsyncJobController } from '../ec2-async-job/Ec2AsyncJobController';
import type { Ec2DashboardController } from './Ec2DashboardController';

describe('DecisionDashboard async path', () => {
  it('does not call mock provider instances on initialize', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const asyncJobs = {
      initialize: vi.fn().mockResolvedValue(undefined),
    } as unknown as Ec2AsyncJobController;
    const ec2Dashboard = {
      load: vi.fn().mockResolvedValue(undefined),
    } as unknown as Ec2DashboardController;

    const candidateSelect = document.createElement('select');
    const dashboard = new DecisionDashboard(
      {
        stateMessage: document.createElement('div'),
        overview: document.createElement('div'),
        progress: document.createElement('div'),
        candidate: document.createElement('div'),
        evidence: document.createElement('div'),
        governance: document.createElement('div'),
        financial: document.createElement('div'),
        confidence: document.createElement('div'),
        recommendation: document.createElement('div'),
        verification: document.createElement('div'),
        analyzeButton: document.createElement('button'),
        candidateSelect,
      },
      ec2Dashboard,
      asyncJobs,
    );

    await dashboard.initialize();

    const mockInstanceCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/providers/mock/instances'),
    );
    expect(mockInstanceCalls).toHaveLength(0);
    expect(candidateSelect.disabled).toBe(true);
    fetchSpy.mockRestore();
  });
});
