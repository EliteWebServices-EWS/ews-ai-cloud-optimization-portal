import { describe, it, expect } from 'vitest';
import { mapEc2AsyncJobToDisplayState } from './ec2-async-job-status-mapping';

describe('ec2 async job status mapping', () => {
  it('maps QUEUED to Queued', () => {
    expect(mapEc2AsyncJobToDisplayState('QUEUED', 'ENQUEUE').label).toBe('Queued');
  });

  it('supports local starting transition after 202', () => {
    expect(
      mapEc2AsyncJobToDisplayState('QUEUED', 'ENQUEUE', { localStarting: true }).label,
    ).toBe('Starting');
  });

  it('maps DISCOVERY to Discovering Resources', () => {
    expect(mapEc2AsyncJobToDisplayState('RUNNING', 'DISCOVERY').label).toBe(
      'Discovering Resources',
    );
  });

  it('maps COST_ANALYSIS', () => {
    expect(mapEc2AsyncJobToDisplayState('RUNNING', 'COST_ANALYSIS').label).toBe(
      'Running Cost Analysis',
    );
  });

  it('maps SECURITY_ANALYSIS', () => {
    expect(mapEc2AsyncJobToDisplayState('RUNNING', 'SECURITY_ANALYSIS').label).toBe(
      'Running Security Analysis',
    );
  });

  it('maps GOVERNANCE_ANALYSIS', () => {
    expect(mapEc2AsyncJobToDisplayState('RUNNING', 'GOVERNANCE_ANALYSIS').label).toBe(
      'Running Governance Analysis',
    );
  });

  it('maps FINALIZING to Generating Recommendations', () => {
    expect(mapEc2AsyncJobToDisplayState('RUNNING', 'FINALIZING').label).toBe(
      'Generating Recommendations',
    );
  });

  it('maps SUCCEEDED/COMPLETE to Completed', () => {
    const state = mapEc2AsyncJobToDisplayState('SUCCEEDED', 'COMPLETE');
    expect(state.label).toBe('Completed');
    expect(state.terminal).toBe(true);
  });

  it('maps FAILED to Failed', () => {
    const state = mapEc2AsyncJobToDisplayState('FAILED', 'DISCOVERY');
    expect(state.label).toBe('Failed');
    expect(state.failed).toBe(true);
  });

  it('uses Processing fallback for unknown combinations', () => {
    expect(mapEc2AsyncJobToDisplayState('PARTIAL', 'DISCOVERY').label).toBe('Processing');
  });
});
