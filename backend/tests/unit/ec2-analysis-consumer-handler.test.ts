import assert from 'node:assert/strict';
import type { SQSRecord } from 'aws-lambda';
import { describe, it } from 'node:test';

import { buildEc2IntelligenceQueueMessage } from '../../async-jobs/ec2-intelligence-queue-message';
import { processEc2AnalysisSqsBatch } from '../../ec2-analysis-consumer/process-sqs-batch';
import type { Ec2AsyncJobConsumerService } from '../../services/ec2-async-job-consumer-service';

function sqsRecord(messageId: string, body: string): SQSRecord {
  return {
    messageId,
    body,
    receiptHandle: 'rh',
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '1',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123:q',
    awsRegion: 'us-east-1',
  };
}

describe('processEc2AnalysisSqsBatch', () => {
  it('returns only retryable record ids in batchItemFailures', async () => {
    const valid = buildEc2IntelligenceQueueMessage({
      jobId: 'job-a',
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      correlationId: 'corr-a',
    });

    const consumer = {
      processValidatedMessage: async (message: { jobId: string }) => {
        return message.jobId === 'job-retryable' ? 'retry' : ('ack' as const);
      },
    } as unknown as Ec2AsyncJobConsumerService;

    const response = await processEc2AnalysisSqsBatch(
      {
        Records: [
          sqsRecord('msg-ok', JSON.stringify(valid)),
          sqsRecord('msg-bad-json', '{'),
          sqsRecord(
            'msg-retryable',
            JSON.stringify({ ...valid, jobId: 'job-retryable' }),
          ),
        ],
      },
      consumer,
      'lambda-req',
    );

    assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: 'msg-retryable' }]);
  });

  it('acknowledges malformed JSON without batch failure', async () => {
    const consumer = {
      processValidatedMessage: async () => 'ack' as const,
    } as unknown as Ec2AsyncJobConsumerService;

    const response = await processEc2AnalysisSqsBatch(
      { Records: [sqsRecord('msg-bad', '{invalid')] },
      consumer,
      'lambda-req',
    );
    assert.deepEqual(response.batchItemFailures, []);
  });

  it('retries unexpected handler failures', async () => {
    const valid = buildEc2IntelligenceQueueMessage({
      jobId: 'job-a',
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      correlationId: 'corr-a',
    });
    const consumer = {
      processValidatedMessage: async () => {
        throw new Error('unexpected');
      },
    } as unknown as Ec2AsyncJobConsumerService;

    const response = await processEc2AnalysisSqsBatch(
      { Records: [sqsRecord('msg-retry', JSON.stringify(valid))] },
      consumer,
      'lambda-req',
    );
    assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: 'msg-retry' }]);
  });
});
