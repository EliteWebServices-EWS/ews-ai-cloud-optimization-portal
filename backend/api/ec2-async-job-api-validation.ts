import { parseEc2CostAccountId } from './ec2-cost-request-validators';
import { resolveEc2CostAnalysisRegions } from '../services/ec2-cost-analysis-api-service';
import { Ec2CostValidationError } from '../services/ec2-cost-analysis-api-service';
import { EC2_ASYNC_JOB_TYPE } from '../database/async-jobs';

export class Ec2AsyncJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2AsyncJobValidationError';
  }
}

export interface StartEc2AsyncJobBody {
  accountId: string;
  regions?: string[];
}

export function parseStartEc2AsyncJobBody(body: unknown): StartEc2AsyncJobBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Ec2AsyncJobValidationError('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'accountId' && key !== 'regions') {
      throw new Ec2AsyncJobValidationError(`Unexpected field: ${key}`);
    }
  }
  if (typeof record.accountId !== 'string') {
    throw new Ec2AsyncJobValidationError('accountId is required.');
  }
  parseEc2CostAccountId(record.accountId);
  let regions: string[] | undefined;
  if (record.regions !== undefined) {
    if (!Array.isArray(record.regions)) {
      throw new Ec2AsyncJobValidationError('regions must be an array of region codes.');
    }
    regions = record.regions as string[];
  }
  return { accountId: record.accountId, regions };
}

export function parseEc2AsyncJobListQuery(
  query: Record<string, unknown>,
): { limit?: number; nextToken?: string } {
  const result: { limit?: number; nextToken?: string } = {};
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Ec2AsyncJobValidationError('limit must be an integer between 1 and 100.');
    }
    result.limit = limit;
  }
  if (query.nextToken !== undefined) {
    if (typeof query.nextToken !== 'string' || !query.nextToken.trim()) {
      throw new Ec2AsyncJobValidationError('nextToken must be a non-empty string.');
    }
    result.nextToken = query.nextToken;
  }
  return result;
}

export function validateEc2AsyncJobRegionsForAccount(
  body: StartEc2AsyncJobBody,
  defaultRegion: string,
): string[] {
  try {
    return resolveEc2CostAnalysisRegions(
      { accountId: body.accountId, regions: body.regions },
      defaultRegion,
    );
  } catch (error) {
    if (error instanceof Ec2CostValidationError) {
      throw new Ec2AsyncJobValidationError(error.message);
    }
    throw error;
  }
}

export function assertEc2AsyncJobType(value: string): asserts value is typeof EC2_ASYNC_JOB_TYPE {
  if (value !== EC2_ASYNC_JOB_TYPE) {
    throw new Ec2AsyncJobValidationError('Unsupported job type.');
  }
}
