import type { Context, SQSEvent, SQSBatchResponse } from 'aws-lambda';

import { processEc2AnalysisSqsBatch } from './ec2-analysis-consumer/process-sqs-batch';
import { createEc2AsyncJobConsumerServiceFromEnv } from './services/ec2-async-job-consumer-factory';
import type { Ec2AsyncJobConsumerService } from './services/ec2-async-job-consumer-service';

let consumerService: Ec2AsyncJobConsumerService | undefined;

export async function handler(
  event: SQSEvent,
  context: Context,
): Promise<SQSBatchResponse> {
  consumerService ??= createEc2AsyncJobConsumerServiceFromEnv();
  return processEc2AnalysisSqsBatch(event, consumerService, context.awsRequestId);
}
