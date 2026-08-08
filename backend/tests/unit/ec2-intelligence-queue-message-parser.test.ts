import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Ec2IntelligenceQueueMessageParseError,
  parseEc2IntelligenceQueueMessageBody,
} from '../../async-jobs/parse-ec2-intelligence-queue-message';
import { buildEc2IntelligenceQueueMessage } from '../../async-jobs/ec2-intelligence-queue-message';

function validMessage() {
  return buildEc2IntelligenceQueueMessage({
    jobId: 'job-1',
    tenantId: 'tenant-a',
    accountId: '111122223333',
    regions: ['us-east-1'],
    correlationId: 'corr-1',
  });
}

describe('parseEc2IntelligenceQueueMessageBody', () => {
  it('parses a valid message', () => {
    const parsed = parseEc2IntelligenceQueueMessageBody(JSON.stringify(validMessage()));
    assert.equal(parsed.jobType, 'EC2_INTELLIGENCE');
    assert.equal(parsed.schemaVersion, 1);
  });

  it('rejects malformed JSON', () => {
    assert.throws(
      () => parseEc2IntelligenceQueueMessageBody('{'),
      Ec2IntelligenceQueueMessageParseError,
    );
  });

  it('rejects unsupported schema version', () => {
    const body = { ...validMessage(), schemaVersion: 2 };
    assert.throws(
      () => parseEc2IntelligenceQueueMessageBody(JSON.stringify(body)),
      /schemaVersion/,
    );
  });

  it('rejects incorrect jobType', () => {
    const body = { ...validMessage(), jobType: 'OTHER' };
    assert.throws(() => parseEc2IntelligenceQueueMessageBody(JSON.stringify(body)), /jobType/);
  });

  it('requires jobId, tenantId, and correlationId', () => {
    assert.throws(
      () =>
        parseEc2IntelligenceQueueMessageBody(
          JSON.stringify({ ...validMessage(), jobId: '' }),
        ),
      /jobId/,
    );
    assert.throws(
      () =>
        parseEc2IntelligenceQueueMessageBody(
          JSON.stringify({ ...validMessage(), tenantId: '  ' }),
        ),
      /tenantId/,
    );
    assert.throws(
      () =>
        parseEc2IntelligenceQueueMessageBody(
          JSON.stringify({ ...validMessage(), correlationId: '' }),
        ),
      /correlationId/,
    );
  });

  it('validates accountId and regions', () => {
    assert.throws(
      () =>
        parseEc2IntelligenceQueueMessageBody(
          JSON.stringify({ ...validMessage(), accountId: 'bad' }),
        ),
    );
    assert.throws(
      () =>
        parseEc2IntelligenceQueueMessageBody(
          JSON.stringify({ ...validMessage(), regions: [] }),
        ),
      /regions/,
    );
    assert.throws(
      () =>
        parseEc2IntelligenceQueueMessageBody(
          JSON.stringify({ ...validMessage(), regions: ['not-a-region'] }),
        ),
    );
  });

  it('deduplicates equivalent regions', () => {
    const parsed = parseEc2IntelligenceQueueMessageBody(
      JSON.stringify({ ...validMessage(), regions: ['us-east-1', 'us-east-1', 'eu-west-1'] }),
    );
    assert.deepEqual(parsed.regions, ['us-east-1', 'eu-west-1']);
  });
});
