/**
 * Bounded API input validation for security-sensitive request fields.
 */

import { PLUGIN_NAMES } from '../shared/constants';
import { AppError } from '../shared/utils';

const IDENTIFIER_MAX_LENGTH = 128;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

export interface WorkflowRunInput {
  plugin: string;
  mode: 'full' | 'dry-run';
  resourceId?: string;
  region: string;
}

export interface ReportGenerateInput {
  workflowId: string;
}

function assertNonEmptyString(
  value: unknown,
  fieldName: string,
  maxLength = IDENTIFIER_MAX_LENGTH
): string {
  if (typeof value !== 'string') {
    throw new AppError(
      'INVALID_REQUEST',
      `${fieldName} must be a string.`,
      400,
      'request'
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new AppError(
      'INVALID_REQUEST',
      `${fieldName} is required.`,
      400,
      'request'
    );
  }

  if (trimmed.length > maxLength) {
    throw new AppError(
      'INVALID_REQUEST',
      `${fieldName} exceeds the maximum allowed length.`,
      400,
      'request'
    );
  }

  return trimmed;
}

export function validateResourceId(
  value: unknown
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const resourceId = assertNonEmptyString(
    value,
    'resourceId'
  );

  if (!IDENTIFIER_PATTERN.test(resourceId)) {
    throw new AppError(
      'INVALID_REQUEST',
      'resourceId contains unsupported characters.',
      400,
      'request'
    );
  }

  return resourceId;
}

export function validateRegion(value: unknown): string {
  if (value === undefined || value === null) {
    throw new AppError(
      'INVALID_REQUEST',
      'region must be a valid AWS region identifier.',
      400,
      'request'
    );
  }

  const region = assertNonEmptyString(value, 'region', 32);

  if (!AWS_REGION_PATTERN.test(region)) {
    throw new AppError(
      'INVALID_REQUEST',
      'region must be a valid AWS region identifier.',
      400,
      'request'
    );
  }

  return region;
}

export function validateWorkflowRunBody(
  body: unknown,
  defaultRegion: string
): WorkflowRunInput {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const plugin =
    payload.plugin === undefined
      ? PLUGIN_NAMES.EC2
      : assertNonEmptyString(payload.plugin, 'plugin', 64);

  if (plugin !== PLUGIN_NAMES.EC2) {
    throw new AppError(
      'PLUGIN_NOT_FOUND',
      `Plugin not supported: ${plugin}`,
      404,
      'request'
    );
  }

  const mode =
    payload.mode === undefined
      ? 'full'
      : payload.mode;

  if (mode !== 'full' && mode !== 'dry-run') {
    throw new AppError(
      'INVALID_REQUEST',
      'mode must be either full or dry-run.',
      400,
      'request'
    );
  }

  const resourceId = validateResourceId(payload.resourceId);

  const region =
    payload.region === undefined
      ? defaultRegion
      : validateRegion(payload.region);

  return {
    plugin,
    mode,
    resourceId,
    region,
  };
}

export function validateReportGenerateBody(
  body: unknown
): ReportGenerateInput {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const workflowId = assertNonEmptyString(
    payload.workflowId,
    'workflowId'
  );

  if (!IDENTIFIER_PATTERN.test(workflowId)) {
    throw new AppError(
      'INVALID_REQUEST',
      'workflowId contains unsupported characters.',
      400,
      'request'
    );
  }

  return { workflowId };
}

export function validatePaginationToken(
  value: unknown
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const token = assertNonEmptyString(
    value,
    'nextToken',
    2048
  );

  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new AppError(
      'INVALID_REQUEST',
      'nextToken contains unsupported characters.',
      400,
      'request'
    );
  }

  return token;
}

export function validateReportQueryLimit(
  value: unknown,
  fallback: number,
  max: number
): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new AppError(
      'INVALID_REQUEST',
      'limit must be a positive integer.',
      400,
      'request'
    );
  }

  return Math.min(parsed, max);
}
