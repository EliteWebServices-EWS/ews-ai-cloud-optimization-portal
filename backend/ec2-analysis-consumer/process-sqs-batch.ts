import type { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda';

import {
  Ec2IntelligenceQueueMessageParseError,
  parseEc2IntelligenceQueueMessageBody,
} from '../async-jobs/parse-ec2-intelligence-queue-message';
import { createLogger } from '../shared/utils';
import type { Ec2AsyncJobConsumerService } from '../services/ec2-async-job-consumer-service';

const logger = createLogger('Ec2AnalysisConsumerHandler');

export async function processEc2AnalysisSqsBatch(
  event: SQSEvent,
  consumer: Ec2AsyncJobConsumerService,
  lambdaAwsRequestId: string,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    const outcome = await processEc2AnalysisSqsRecord(record, consumer, lambdaAwsRequestId);
    if (outcome === 'retry') {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function processEc2AnalysisSqsRecord(
  record: SQSRecord,
  consumer: Ec2AsyncJobConsumerService,
  lambdaAwsRequestId: string,
): Promise<'ack' | 'retry'> {
  const processingRequestId = `${lambdaAwsRequestId}:${record.messageId}`;

  try {
    const message = parseEc2IntelligenceQueueMessageBody(record.body);
    return await consumer.processValidatedMessage(message, processingRequestId);
  } catch (error) {
    if (error instanceof Ec2IntelligenceQueueMessageParseError) {
      logger.warn(
        `Rejecting non-retryable SQS message messageId=${record.messageId} reason=${error.message}`,
      );
      return 'ack';
    }
    logger.error(
      `Unexpected handler failure for SQS record messageId=${record.messageId} errorName=${
        error instanceof Error ? error.name : 'UnknownError'
      }`,
    );
    return 'retry';
  }
}
