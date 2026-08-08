import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { Ec2IntelligenceQueueMessage } from './ec2-intelligence-queue-message';
import {
  Ec2IntelligenceQueueSendError,
  MockEc2IntelligenceQueueSender,
  type Ec2IntelligenceQueueSender,
} from './ec2-intelligence-queue-sender';

export class SqsEc2IntelligenceQueueSender implements Ec2IntelligenceQueueSender {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async send(message: Ec2IntelligenceQueueMessage): Promise<void> {
    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );
    } catch {
      throw new Ec2IntelligenceQueueSendError();
    }
  }
}

export function createEc2IntelligenceQueueSenderFromEnv(): Ec2IntelligenceQueueSender {
  const queueUrl = process.env.EC2_INTELLIGENCE_QUEUE_URL?.trim();
  if (!queueUrl) {
    return new MockEc2IntelligenceQueueSender();
  }
  return new SqsEc2IntelligenceQueueSender(new SQSClient({}), queueUrl);
}
