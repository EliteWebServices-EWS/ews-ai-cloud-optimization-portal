import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../api/client';
import { startEc2Analysis, listEc2AnalysisJobs, createIdempotencyKey } from '../api/ec2-async-job-api';

describe('ec2-async-job-api authenticated path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('startEc2Analysis uses apiRequest with Idempotency-Key header', async () => {
    const apiRequest = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      jobId: 'job-1',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });

    await startEc2Analysis({ accountId: '111122223333', regions: ['us-east-1'] }, 'idem-uuid');

    expect(apiRequest).toHaveBeenCalledWith('/analysis/ec2/start', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-uuid' },
      body: JSON.stringify({ accountId: '111122223333', regions: ['us-east-1'] }),
    });
  });

  it('listEc2AnalysisJobs passes pagination query', async () => {
    const apiRequest = vi.spyOn(client, 'apiRequest').mockResolvedValue({ items: [], nextToken: 'tok' });
    await listEc2AnalysisJobs({ limit: 20, nextToken: 'tok' });
    expect(apiRequest).toHaveBeenCalledWith('/analysis/jobs?limit=20&nextToken=tok');
  });

  it('propagates auth errors without fabricating jobs', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValue(
      new client.ApiClientError('SESSION_EXPIRED', 'Your session expired. Redirecting to secure sign-in.'),
    );
    await expect(startEc2Analysis({ accountId: '111122223333' }, 'k')).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('createIdempotencyKey uses randomUUID', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(createIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555');
  });
});
