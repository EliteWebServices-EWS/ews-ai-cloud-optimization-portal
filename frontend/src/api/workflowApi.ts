/**
 * Workflow API client — communicates with backend workflow endpoints.
 * UI components must not call fetch directly; use this module.
 */

import { apiRequest } from './client';
import type {
  MockInstance,
  RunWorkflowRequest,
  WorkflowDetail,
  WorkflowRunResult,
  WorkflowStatusSummary,
} from '../types';

export async function runWorkflow(request: RunWorkflowRequest = {}): Promise<WorkflowRunResult> {
  return apiRequest<WorkflowRunResult>('/workflows/run', {
    method: 'POST',
    body: JSON.stringify({
      plugin: request.plugin ?? 'ec2',
      mode: request.mode ?? 'full',
      resourceId: request.resourceId,
      region: request.region ?? 'us-east-1',
    }),
  });
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDetail> {
  return apiRequest<WorkflowDetail>(`/workflows/${workflowId}`);
}

export async function getWorkflowStatus(workflowId: string): Promise<WorkflowStatusSummary> {
  return apiRequest<WorkflowStatusSummary>(`/workflows/status/${workflowId}`);
}

export async function getMockInstances(region = 'us-east-1'): Promise<MockInstance[]> {
  const data = await apiRequest<{ instances: MockInstance[] }>(
    `/providers/mock/instances?region=${encodeURIComponent(region)}`
  );
  return data.instances;
}

export async function getPlugins(): Promise<Array<{ name: string; version: string; description: string }>> {
  const data = await apiRequest<{ plugins: Array<{ name: string; version: string; description: string }> }>(
    '/plugins'
  );
  return data.plugins;
}

export async function checkHealth(): Promise<{ status: string; service: string }> {
  return apiRequest<{ status: string; service: string }>('/health');
}
