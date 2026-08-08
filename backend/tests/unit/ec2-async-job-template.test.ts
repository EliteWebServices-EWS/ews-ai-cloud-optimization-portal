import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const templatePath = path.join(__dirname, '../../template.yaml');

describe('EC2 async intelligence SAM template', () => {
  const template = readFileSync(templatePath, 'utf8');

  it('defines SisumEc2IntelligenceQueue with DLQ redrive and retention', () => {
    assert.match(template, /SisumEc2IntelligenceQueue:/);
    assert.match(template, /SisumEc2IntelligenceDlq:/);
    assert.match(template, /deadLetterTargetArn: !GetAtt SisumEc2IntelligenceDlq\.Arn/);
    assert.match(template, /maxReceiveCount: 5/);
    assert.match(template, /MessageRetentionPeriod: 345600/);
    assert.match(template, /MessageRetentionPeriod: 1209600/);
  });

  it('enables SQS encryption on work queue and DLQ', () => {
    const queueSection = template.slice(
      template.indexOf('SisumEc2IntelligenceDlq'),
      template.indexOf('SisumBusinessPersistencePolicy'),
    );
    assert.match(queueSection, /SqsManagedSseEnabled: true/g);
  });

  it('scopes producer IAM to sqs:SendMessage on the queue ARN only', () => {
    const policySection = template.slice(
      template.indexOf('SisumEc2IntelligenceQueueSendPolicy'),
      template.indexOf('SisumStsAssumeRolePolicy'),
    );
    assert.match(policySection, /sqs:SendMessage/);
    assert.match(policySection, /Resource: !GetAtt SisumEc2IntelligenceQueue\.Arn/);
    assert.doesNotMatch(policySection, /sqs:\*/);
    assert.doesNotMatch(policySection, /ReceiveMessage/);
  });

  it('defines SisumAsyncJobsTable with gsi1 and env wiring', () => {
    assert.match(template, /SisumAsyncJobsTable:/);
    assert.match(template, /sisum-async-jobs-\$\{Environment\}/);
    assert.match(template, /ASYNC_JOBS_TABLE_NAME/);
    assert.match(template, /Ec2AsyncJobPersistence/);
  });
});
