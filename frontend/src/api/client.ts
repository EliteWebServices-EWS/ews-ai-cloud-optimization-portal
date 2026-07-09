/**
 * Base API client — handles fetch, response parsing, and error normalization.
 */

import type { ApiErrorResponse, ApiSuccessResponse } from '../types';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly stage?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const DEFAULT_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${DEFAULT_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const body = (await response.json()) as ApiSuccessResponse<T> | ApiErrorResponse;

  if (!body.success) {
    throw new ApiClientError(
      body.error.code,
      body.error.message,
      body.error.stage
    );
  }

  return body.data;
}
