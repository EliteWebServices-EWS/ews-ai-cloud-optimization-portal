import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listReports } from './reportApi';
import * as client from './client';

describe('reportApi listReports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes reportSource=ec2_async (exact param name) on the HTTP query string', async () => {
    const apiRequest = vi.spyOn(client, 'apiRequest').mockResolvedValue({ reports: [], total: 0 });

    await listReports({
      reportSource: 'ec2_async',
      status: 'complete',
      resourceType: 'EC2',
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const path = apiRequest.mock.calls[0]?.[0] as string;
    expect(path).toMatch(/^\/reports\?/);
    expect(path).toContain('reportSource=ec2_async');
    expect(path).not.toMatch(/report_source|report-source|(?:^|[&?])source=/);
    expect(path).toContain('status=complete');
    expect(path).toContain('resourceType=EC2');
  });
});
