import type { Ec2IntelligenceQueueMessage } from '../async-jobs/ec2-intelligence-queue-message';

export class Ec2IntelligenceQueueSendError extends Error {
  constructor(message = 'EC2 intelligence queue delivery failed.') {
    super(message);
    this.name = 'Ec2IntelligenceQueueSendError';
  }
}

export interface Ec2IntelligenceQueueSender {
  send(message: Ec2IntelligenceQueueMessage): Promise<void>;
}

export class MockEc2IntelligenceQueueSender implements Ec2IntelligenceQueueSender {
  readonly sent: Ec2IntelligenceQueueMessage[] = [];
  failNext = false;

  async send(message: Ec2IntelligenceQueueMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Ec2IntelligenceQueueSendError();
    }
    this.sent.push({ ...message, regions: [...message.regions] });
  }
}
