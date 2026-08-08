export const EC2_INTELLIGENCE_QUEUE_MESSAGE_SCHEMA_VERSION = 1 as const;

export interface Ec2IntelligenceQueueMessage {
  schemaVersion: typeof EC2_INTELLIGENCE_QUEUE_MESSAGE_SCHEMA_VERSION;
  jobId: string;
  tenantId: string;
  accountId: string;
  regions: string[];
  jobType: 'EC2_INTELLIGENCE';
  correlationId: string;
}

export function buildEc2IntelligenceQueueMessage(
  job: Pick<
    Ec2IntelligenceQueueMessage,
    'jobId' | 'tenantId' | 'accountId' | 'regions' | 'correlationId'
  >,
): Ec2IntelligenceQueueMessage {
  return {
    schemaVersion: EC2_INTELLIGENCE_QUEUE_MESSAGE_SCHEMA_VERSION,
    jobType: 'EC2_INTELLIGENCE',
    jobId: job.jobId,
    tenantId: job.tenantId,
    accountId: job.accountId,
    regions: [...job.regions],
    correlationId: job.correlationId,
  };
}
