/**
 * EC2 asynchronous analysis job API — authenticated requests via shared apiRequest.
 */

import { apiRequest } from './client';
import type {
  Ec2AsyncJob,
  Ec2AsyncJobEventsPage,
  Ec2AsyncJobListPage,
  Ec2AsyncJobStartResult,
  StartEc2AnalysisRequest,
} from './ec2-async-job-types';

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('Secure idempotency key generation is unavailable in this browser.');
}

export async function startEc2Analysis(
  body: StartEc2AnalysisRequest,
  idempotencyKey: string,
): Promise<Ec2AsyncJobStartResult> {
  return apiRequest<Ec2AsyncJobStartResult>('/analysis/ec2/start', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

export async function listEc2AnalysisJobs(options?: {
  limit?: number;
  nextToken?: string;
}): Promise<Ec2AsyncJobListPage> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.nextToken) {
    params.set('nextToken', options.nextToken);
  }
  const query = params.toString();
  const path = query ? `/analysis/jobs?${query}` : '/analysis/jobs';
  return apiRequest<Ec2AsyncJobListPage>(path);
}

export async function getEc2AnalysisJob(jobId: string): Promise<Ec2AsyncJob> {
  return apiRequest<Ec2AsyncJob>(`/analysis/jobs/${encodeURIComponent(jobId)}`);
}

export async function getEc2AnalysisJobEvents(
  jobId: string,
  options?: { limit?: number; nextToken?: string },
): Promise<Ec2AsyncJobEventsPage> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.nextToken) {
    params.set('nextToken', options.nextToken);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  return apiRequest<Ec2AsyncJobEventsPage>(
    `/analysis/jobs/${encodeURIComponent(jobId)}/events${suffix}`,
  );
}
