/**
 * Tenant-scoped EC2 dashboard API client.
 * Uses explicit bearer tokens — never falls back to demo data.
 */

import type { ApiErrorResponse, ApiSuccessResponse } from '../types';

const DEFAULT_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

export class Ec2DashboardApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'Ec2DashboardApiError';
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let body: ApiSuccessResponse<T> | ApiErrorResponse;
  try {
    body = (await response.json()) as ApiSuccessResponse<T> | ApiErrorResponse;
  } catch {
    throw new Ec2DashboardApiError(
      'INVALID_API_RESPONSE',
      'The API returned an unexpected response.',
      response.status,
    );
  }

  if (!response.ok || !body.success) {
    if ('error' in body) {
      throw new Ec2DashboardApiError(body.error.code, body.error.message, response.status);
    }
    throw new Ec2DashboardApiError(
      'API_REQUEST_FAILED',
      `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  return body.data;
}

export interface Ec2ResourceSummaryApi {
  totalResources: number;
  instancesByState: Record<string, number>;
  instancesByRegion: Record<string, number>;
  instancesByInstanceType: Record<string, number>;
  resourcesByType: Record<string, number>;
  staleResourceCount: number;
  latestSuccessfulDiscoveryAt?: string;
}

export interface Ec2CostRecommendationApi {
  recommendationId: string;
  accountId: string;
  region: string;
  resourceId: string;
  category: string;
  severity: string;
  confidenceLevel: string;
  title: string;
  summary: string;
  businessJustification: string;
  recommendedAction: string;
  pricingStatus: string;
  estimatedMonthlySavings?: number;
  currentMonthlyCost?: number;
  analyzedAt?: string;
}

export interface Ec2CostListApi {
  items: Ec2CostRecommendationApi[];
  nextToken?: string;
  savingsSummary: {
    validatedMonthlySavings: number;
    sampleEstimateMonthlySavings: number;
    currency: string;
  };
}

export interface AwsAccountListItem {
  accountId: string;
  displayName?: string;
  status: string;
  verificationStatus?: string;
}

export interface AwsAccountListApi {
  accounts: AwsAccountListItem[];
  total: number;
}

async function authorizedFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`${DEFAULT_BASE}${path}`, { ...init, headers });
}

export async function listTenantAwsAccounts(
  accessToken: string,
  limit = 25,
): Promise<AwsAccountListApi> {
  const response = await authorizedFetch(
    accessToken,
    `/aws-accounts?limit=${encodeURIComponent(String(limit))}`,
  );
  return parseEnvelope<AwsAccountListApi>(response);
}

export async function fetchEc2ResourceSummary(
  accessToken: string,
  accountId: string,
  region?: string,
): Promise<Ec2ResourceSummaryApi> {
  const params = new URLSearchParams({ accountId });
  if (region) {
    params.set('region', region);
  }
  const response = await authorizedFetch(
    accessToken,
    `/ec2/resources/summary?${params.toString()}`,
  );
  return parseEnvelope<Ec2ResourceSummaryApi>(response);
}

export async function fetchEc2CostRecommendations(
  accessToken: string,
  accountId: string,
  region?: string,
  limit = 50,
): Promise<Ec2CostListApi> {
  const params = new URLSearchParams({
    accountId,
    limit: String(limit),
  });
  if (region) {
    params.set('region', region);
  }
  const response = await authorizedFetch(
    accessToken,
    `/recommendations/ec2/cost?${params.toString()}`,
  );
  return parseEnvelope<Ec2CostListApi>(response);
}
