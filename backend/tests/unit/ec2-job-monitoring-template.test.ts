import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const template = readFileSync(
  join(__dirname, '../../../infrastructure/monitoring/template.yaml'),
  'utf8',
);

describe('EC2 job monitoring infrastructure', () => {
  it('defines the queue, worker, and threshold parameters', () => {
    for (const parameter of [
      'Ec2JobQueueName:',
      'Ec2JobDeadLetterQueueName:',
      'Ec2JobProducerFunctionName:',
      'Ec2JobWorkerFunctionName:',
      'Ec2JobQueueAgeThresholdSeconds:',
      'Ec2JobRetryRateThresholdPercent:',
    ]) {
      assert.match(template, new RegExp(parameter));
    }
  });

  it('creates all required reliability alarms', () => {
    for (const alarm of [
      'Ec2JobDlqMessagesAlarm:',
      'Ec2JobQueueAgeAlarm:',
      'Ec2JobWorkerErrorsAlarm:',
      'Ec2JobRetryRateAlarm:',
      'Ec2JobWorkerThrottlesAlarm:',
      'Ec2JobTimeoutAlarm:',
    ]) {
      assert.match(template, new RegExp(alarm));
    }
  });

  it('turns canonical audit events into job lifecycle metrics', () => {
    for (const eventName of [
      'ec2.job_queued', 'ec2.job_started', 'ec2.job_retry', 'ec2.job_partial',
      'ec2.job_failed', 'ec2.job_completed', 'ec2.job_dlq_moved', 'ec2.job_redrive_completed',
    ]) {
      assert.match(template, new RegExp(eventName.replace('.', '\\.')));
    }
  });

  it('includes every requested operational metric on the EC2 jobs dashboard', () => {
    for (const metric of [
      'ApproximateNumberOfMessagesVisible', 'ApproximateAgeOfOldestMessage',
      'Errors', 'Duration', 'ConcurrentExecutions', 'Success Rate', 'Retry Rate',
    ]) {
      assert.match(template, new RegExp(metric));
    }
  });
});
