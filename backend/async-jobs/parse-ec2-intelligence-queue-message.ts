import { EC2_INTELLIGENCE_QUEUE_MESSAGE_SCHEMA_VERSION } from './ec2-intelligence-queue-message';
import type { Ec2IntelligenceQueueMessage } from './ec2-intelligence-queue-message';
import { parseEc2CostAccountId, parseEc2CostRegion } from '../api/ec2-cost-request-validators';

export class Ec2IntelligenceQueueMessageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2IntelligenceQueueMessageParseError';
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Ec2IntelligenceQueueMessageParseError(`${field} is required.`);
  }
  return value.trim();
}

export function parseEc2IntelligenceQueueMessageBody(body: string): Ec2IntelligenceQueueMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Ec2IntelligenceQueueMessageParseError('Message body must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Ec2IntelligenceQueueMessageParseError('Message body must be a JSON object.');
  }

  const record = parsed as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== EC2_INTELLIGENCE_QUEUE_MESSAGE_SCHEMA_VERSION) {
    throw new Ec2IntelligenceQueueMessageParseError('Unsupported schemaVersion.');
  }

  const jobType = record.jobType;
  if (jobType !== 'EC2_INTELLIGENCE') {
    throw new Ec2IntelligenceQueueMessageParseError('Unsupported jobType.');
  }

  const jobId = requireNonEmptyString(record.jobId, 'jobId');
  const tenantId = requireNonEmptyString(record.tenantId, 'tenantId');
  const correlationId = requireNonEmptyString(record.correlationId, 'correlationId');
  const accountId = parseEc2CostAccountId(requireNonEmptyString(record.accountId, 'accountId'));

  if (!Array.isArray(record.regions) || record.regions.length === 0) {
    throw new Ec2IntelligenceQueueMessageParseError('regions must be a non-empty array.');
  }

  const regions: string[] = [];
  const seen = new Set<string>();
  for (const region of record.regions) {
    const normalized = parseEc2CostRegion(requireNonEmptyString(region, 'regions[]'));
    if (!seen.has(normalized)) {
      seen.add(normalized);
      regions.push(normalized);
    }
  }

  return {
    schemaVersion: EC2_INTELLIGENCE_QUEUE_MESSAGE_SCHEMA_VERSION,
    jobType: 'EC2_INTELLIGENCE',
    jobId,
    tenantId,
    accountId,
    regions,
    correlationId,
  };
}
