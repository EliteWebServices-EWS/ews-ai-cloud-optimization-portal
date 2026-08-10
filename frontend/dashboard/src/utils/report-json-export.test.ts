import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildReportJsonFilename } from './report-json-export';
import type { OptimizationReport } from '../types';

describe('report-json-export', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses sisum-report-<reportId>.json filename', () => {
    expect(buildReportJsonFilename('rpt-ec2-async-abc')).toBe('sisum-report-rpt-ec2-async-abc.json');
  });

  it('exports the selected report payload without client-side recomputation', async () => {
    const { downloadOptimizationReportJson } = await import('./report-json-export');
    const click = vi.fn();
    const anchor = { click, href: '', download: '' } as unknown as HTMLAnchorElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    const report = {
      reportId: 'rep-1',
      workflowId: 'wf-1',
      plugin: 'ec2',
      status: 'complete',
    } as OptimizationReport;

    downloadOptimizationReportJson(report);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(anchor.download).toBe('sisum-report-rep-1.json');
    expect(click).toHaveBeenCalled();
  });
});
